use crate::db::{
    models::{
        FinanceItem, FinanceMappingRule, FinancePayment, FinancePlan, FinanceTransaction,
        FinanceTransactionAllocation,
    },
    queries, DbState,
};
use chrono::{NaiveDate, NaiveDateTime};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

const TBANK_SOURCE: &str = "tbank_csv";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedBankTransaction {
    pub source: String,
    pub source_fingerprint: String,
    pub operation_at: String,
    pub payment_date: String,
    pub card_mask: String,
    pub status: String,
    pub amount_cents: i64,
    pub currency: String,
    pub operation_amount_cents: i64,
    pub operation_currency: String,
    pub payment_amount_cents: i64,
    pub payment_currency: String,
    pub cashback_cents: Option<i64>,
    pub bank_category: String,
    pub mcc: String,
    pub description: String,
    pub bonuses_cents: Option<i64>,
    pub invest_rounding_cents: Option<i64>,
    pub rounded_amount_cents: Option<i64>,
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinanceImportPreview {
    pub source: String,
    pub total_rows: i64,
    pub new_rows: i64,
    pub duplicate_rows: i64,
    pub error_rows: i64,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub expense_total_cents: i64,
    pub income_total_cents: i64,
    pub currencies: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinanceImportResult {
    pub batch_id: Option<i64>,
    pub preview: FinanceImportPreview,
    pub mapped_rows: i64,
}

fn parse_csv_line(line: &str) -> Result<Vec<String>, String> {
    let mut fields = Vec::new();
    let mut cur = String::new();
    let mut chars = line.chars().peekable();
    let mut in_quotes = false;
    while let Some(ch) = chars.next() {
        match ch {
            '"' if in_quotes && chars.peek() == Some(&'"') => {
                chars.next();
                cur.push('"');
            }
            '"' => in_quotes = !in_quotes,
            ';' if !in_quotes => {
                fields.push(cur.trim().to_string());
                cur.clear();
            }
            '\r' => {}
            _ => cur.push(ch),
        }
    }
    if in_quotes {
        return Err("unterminated CSV quote".to_string());
    }
    fields.push(cur.trim().to_string());
    Ok(fields)
}

fn parse_tbank_date(value: &str, with_time: bool, label: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if with_time {
        let dt = NaiveDateTime::parse_from_str(trimmed, "%d.%m.%Y %H:%M:%S")
            .map_err(|_| format!("invalid {label}: {value}"))?;
        Ok(dt.format("%Y-%m-%d %H:%M:%S").to_string())
    } else {
        let date = NaiveDate::parse_from_str(trimmed, "%d.%m.%Y")
            .map_err(|_| format!("invalid {label}: {value}"))?;
        Ok(date.format("%Y-%m-%d").to_string())
    }
}

fn payment_date_from_row(payment_date_raw: &str, operation_at: &str) -> Result<String, String> {
    let trimmed = payment_date_raw.trim();
    if !trimmed.is_empty() {
        return parse_tbank_date(trimmed, false, "payment date");
    }
    operation_at
        .split_once(' ')
        .map(|(date, _)| date.to_string())
        .or_else(|| {
            let fallback = operation_at.chars().take(10).collect::<String>();
            if fallback.len() == 10 {
                Some(fallback)
            } else {
                None
            }
        })
        .ok_or_else(|| "missing payment date and operation date fallback".to_string())
}

fn parse_money_cents(value: &str) -> Result<i64, String> {
    let trimmed = value.trim().replace(' ', "").replace(',', ".");
    if trimmed.is_empty() {
        return Ok(0);
    }
    let negative = trimmed.starts_with('-');
    let unsigned = trimmed.trim_start_matches(['-', '+']);
    let mut parts = unsigned.split('.');
    let rubles = parts
        .next()
        .unwrap_or("0")
        .parse::<i64>()
        .map_err(|_| format!("invalid money value: {value}"))?;
    let kopecks_text = parts.next().unwrap_or("0");
    if parts.next().is_some() {
        return Err(format!("invalid money value: {value}"));
    }
    let kopecks = match kopecks_text.len() {
        0 => 0,
        1 => kopecks_text
            .parse::<i64>()
            .map_err(|_| format!("invalid money value: {value}"))?
            * 10,
        _ => kopecks_text[..2]
            .parse::<i64>()
            .map_err(|_| format!("invalid money value: {value}"))?,
    };
    let cents = rubles * 100 + kopecks;
    Ok(if negative { -cents } else { cents })
}

fn parse_optional_money_cents(value: &str) -> Result<Option<i64>, String> {
    if value.trim().is_empty() {
        Ok(None)
    } else {
        parse_money_cents(value).map(Some)
    }
}

fn required<'a>(row: &'a HashMap<String, String>, key: &str) -> Result<&'a str, String> {
    row.get(key)
        .map(String::as_str)
        .ok_or_else(|| format!("missing required CSV header: {key}"))
}

fn fingerprint(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.trim().as_bytes());
        hasher.update(b"\x1f");
    }
    hex::encode(hasher.finalize())
}

fn csv_row_error(row_no: usize, raw_row: &str, error: String) -> String {
    format!("{error}\n\nCSV row {row_no}:\n{raw_row}")
}

fn csv_field_error(
    row_no: usize,
    raw_row: &str,
    column: &str,
    value: &str,
    error: String,
) -> String {
    format!(
        "{error}\n\nColumn: {column}\nValue: {value}\nCSV row {row_no}:\n{raw_row}"
    )
}

fn parse_tbank_csv(content: &str) -> Result<Vec<ParsedBankTransaction>, String> {
    let mut lines = content.lines().filter(|line| !line.trim().is_empty());
    let header_line = lines.next().ok_or_else(|| "CSV is empty".to_string())?;
    let headers = parse_csv_line(header_line)?;
    let required_headers = [
        "Дата операции",
        "Дата платежа",
        "Номер карты",
        "Статус",
        "Сумма операции",
        "Валюта операции",
        "Сумма платежа",
        "Валюта платежа",
        "Кэшбэк",
        "Категория",
        "MCC",
        "Описание",
        "Бонусы (включая кэшбэк)",
        "Округление на инвесткопилку",
        "Сумма операции с округлением",
    ];
    for header in required_headers {
        if !headers.iter().any(|candidate| candidate == header) {
            return Err(format!("missing required CSV header: {header}"));
        }
    }

    let mut parsed = Vec::new();
    for (line_idx, line) in lines.enumerate() {
        let row_no = line_idx + 2;
        let values = parse_csv_line(line).map_err(|err| csv_row_error(row_no, line, err))?;
        if values.len() != headers.len() {
            return Err(csv_row_error(
                row_no,
                line,
                format!(
                    "row {}: expected {} fields, got {}",
                    row_no,
                    headers.len(),
                    values.len()
                ),
            ));
        }
        let row: HashMap<String, String> = headers
            .iter()
            .cloned()
            .zip(values.into_iter())
            .collect();
        let operation_at_raw = required(&row, "Дата операции")?;
        let payment_date_raw = required(&row, "Дата платежа")?;
        let card_mask = required(&row, "Номер карты")?.to_string();
        let status = required(&row, "Статус")?.to_string();
        let operation_amount_raw = required(&row, "Сумма операции")?;
        let operation_currency = required(&row, "Валюта операции")?.to_string();
        let payment_amount_raw = required(&row, "Сумма платежа")?;
        let payment_currency = required(&row, "Валюта платежа")?.to_string();
        let cashback_raw = required(&row, "Кэшбэк")?;
        let bank_category = required(&row, "Категория")?.to_string();
        let mcc = required(&row, "MCC")?.to_string();
        let description = required(&row, "Описание")?.to_string();
        let bonuses_raw = required(&row, "Бонусы (включая кэшбэк)")?;
        let invest_rounding_raw = required(&row, "Округление на инвесткопилку")?;
        let rounded_amount_raw = required(&row, "Сумма операции с округлением")?;

        let operation_at = parse_tbank_date(operation_at_raw, true, "operation date")
            .map_err(|err| csv_field_error(row_no, line, "Дата операции", operation_at_raw, err))?;
        let payment_date = payment_date_from_row(payment_date_raw, &operation_at)
            .map_err(|err| csv_field_error(row_no, line, "Дата платежа", payment_date_raw, err))?;
        let operation_amount_cents = parse_money_cents(operation_amount_raw)
            .map_err(|err| csv_field_error(row_no, line, "Сумма операции", operation_amount_raw, err))?;
        let payment_amount_cents = parse_money_cents(payment_amount_raw)
            .map_err(|err| csv_field_error(row_no, line, "Сумма платежа", payment_amount_raw, err))?;
        let cashback_cents = parse_optional_money_cents(cashback_raw)
            .map_err(|err| csv_field_error(row_no, line, "Кэшбэк", cashback_raw, err))?;
        let bonuses_cents = parse_optional_money_cents(bonuses_raw)
            .map_err(|err| csv_field_error(row_no, line, "Бонусы (включая кэшбэк)", bonuses_raw, err))?;
        let invest_rounding_cents = parse_optional_money_cents(invest_rounding_raw)
            .map_err(|err| csv_field_error(row_no, line, "Округление на инвесткопилку", invest_rounding_raw, err))?;
        let rounded_amount_cents = parse_optional_money_cents(rounded_amount_raw)
            .map_err(|err| csv_field_error(row_no, line, "Сумма операции с округлением", rounded_amount_raw, err))?;
        let source_fingerprint = fingerprint(&[
            TBANK_SOURCE,
            &operation_at,
            &payment_date,
            &card_mask,
            &status,
            operation_amount_raw,
            &operation_currency,
            payment_amount_raw,
            &payment_currency,
            cashback_raw,
            &bank_category,
            &mcc,
            &description,
            bonuses_raw,
            invest_rounding_raw,
            rounded_amount_raw,
        ]);
        let raw_json = json!(row).to_string();
        parsed.push(ParsedBankTransaction {
            source: TBANK_SOURCE.to_string(),
            source_fingerprint,
            operation_at,
            payment_date,
            card_mask,
            status,
            amount_cents: payment_amount_cents,
            currency: payment_currency.clone(),
            operation_amount_cents,
            operation_currency,
            payment_amount_cents,
            payment_currency,
            cashback_cents,
            bank_category,
            mcc,
            description,
            bonuses_cents,
            invest_rounding_cents,
            rounded_amount_cents,
            raw_json,
        });
    }
    Ok(parsed)
}

fn summarize_finance_import(
    conn: &rusqlite::Connection,
    rows: &[ParsedBankTransaction],
) -> Result<FinanceImportPreview, String> {
    let mut new_rows = 0;
    let mut duplicate_rows = 0;
    let mut date_from: Option<String> = None;
    let mut date_to: Option<String> = None;
    let mut expense_total_cents = 0;
    let mut income_total_cents = 0;
    let mut currencies = Vec::<String>::new();
    for row in rows {
        if queries::finance_transaction_fingerprint_exists(
            conn,
            &row.source,
            &row.source_fingerprint,
        )
        .map_err(|e| e.to_string())?
        {
            duplicate_rows += 1;
        } else {
            new_rows += 1;
        }
        if row.amount_cents < 0 {
            expense_total_cents += row.amount_cents.abs();
        } else if row.amount_cents > 0 {
            income_total_cents += row.amount_cents;
        }
        if !currencies.contains(&row.currency) {
            currencies.push(row.currency.clone());
        }
        date_from = Some(match date_from {
            Some(current) if current <= row.payment_date => current,
            _ => row.payment_date.clone(),
        });
        date_to = Some(match date_to {
            Some(current) if current >= row.payment_date => current,
            _ => row.payment_date.clone(),
        });
    }
    currencies.sort();
    Ok(FinanceImportPreview {
        source: TBANK_SOURCE.to_string(),
        total_rows: rows.len() as i64,
        new_rows,
        duplicate_rows,
        error_rows: 0,
        date_from,
        date_to,
        expense_total_cents,
        income_total_cents,
        currencies,
    })
}

fn csv_file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("bank-export.csv")
        .to_string()
}

fn read_finance_csv(path: &str) -> Result<Vec<ParsedBankTransaction>, String> {
    let content = std::fs::read_to_string(path).map_err(|e| format!("failed to read CSV: {e}"))?;
    parse_tbank_csv(&content)
}

#[tauri::command]
pub fn list_finance_plans(state: State<DbState>) -> Result<Vec<FinancePlan>, String> {
    let conn = state.lock_recover();
    queries::list_finance_plans(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_finance_plan(
    state: State<DbState>,
    name: String,
    currency: String,
    kind: Option<String>,
) -> Result<FinancePlan, String> {
    let conn = state.lock_recover();
    queries::create_finance_plan(&conn, &name, &currency, kind.as_deref().unwrap_or("monthly"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_finance_plan(
    state: State<DbState>,
    id: i64,
    name: String,
    currency: String,
    kind: Option<String>,
) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::update_finance_plan(&conn, id, &name, &currency, kind.as_deref().unwrap_or("monthly"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_finance_plans(state: State<DbState>, ids: Vec<i64>) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::reorder_finance_plans(&conn, &ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_finance_plan(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::delete_finance_plan(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_finance_items(
    state: State<DbState>,
    plan_id: i64,
) -> Result<Vec<FinanceItem>, String> {
    let conn = state.lock_recover();
    queries::list_finance_items(&conn, plan_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_finance_item(
    state: State<DbState>,
    plan_id: i64,
    parent_id: Option<i64>,
    name: String,
    amount_cents: i64,
    due_day: Option<i64>,
    due_date: Option<String>,
    note: String,
) -> Result<FinanceItem, String> {
    let conn = state.lock_recover();
    let due_day = due_day
        .map(i32::try_from)
        .transpose()
        .map_err(|_| "due_day is out of range".to_string())?;
    queries::create_finance_item(
        &conn,
        plan_id,
        parent_id,
        &name,
        amount_cents,
        due_day,
        due_date.as_deref(),
        &note,
    )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_finance_item(
    state: State<DbState>,
    id: i64,
    name: String,
    amount_cents: i64,
    due_day: Option<i64>,
    due_date: Option<String>,
    note: String,
) -> Result<(), String> {
    let conn = state.lock_recover();
    let due_day = due_day
        .map(i32::try_from)
        .transpose()
        .map_err(|_| "due_day is out of range".to_string())?;
    queries::update_finance_item(
        &conn,
        id,
        &name,
        amount_cents,
        due_day,
        due_date.as_deref(),
        &note,
    )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_finance_item(
    state: State<DbState>,
    id: i64,
    parent_id: Option<i64>,
    before_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::move_finance_item(&conn, id, parent_id, before_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_finance_item(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::delete_finance_item(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_finance_payments(
    state: State<DbState>,
    plan_id: i64,
) -> Result<Vec<FinancePayment>, String> {
    let conn = state.lock_recover();
    queries::list_finance_payments(&conn, plan_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn upsert_finance_payment(
    state: State<DbState>,
    plan_id: i64,
    item_id: i64,
    month_key: String,
    is_paid: bool,
    paid_amount_cents: i64,
    note: String,
) -> Result<FinancePayment, String> {
    let conn = state.lock_recover();
    queries::upsert_finance_payment(
        &conn,
        plan_id,
        item_id,
        &month_key,
        is_paid,
        paid_amount_cents,
        &note,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pick_finance_csv_file(app: AppHandle) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("CSV", &["csv"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| format!("pick CSV task: {e}"))?;
    Ok(picked
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn preview_finance_bank_csv(
    state: State<DbState>,
    path: String,
) -> Result<FinanceImportPreview, String> {
    let rows = read_finance_csv(&path)?;
    let conn = state.lock_recover();
    summarize_finance_import(&conn, &rows)
}

#[tauri::command]
pub fn import_finance_bank_csv(
    state: State<DbState>,
    path: String,
) -> Result<FinanceImportResult, String> {
    let rows = read_finance_csv(&path)?;
    let conn = state.lock_recover();
    let preview = summarize_finance_import(&conn, &rows)?;
    let batch = queries::create_finance_import_batch(
        &conn,
        TBANK_SOURCE,
        &csv_file_name(&path),
        preview.total_rows,
        preview.new_rows,
        preview.duplicate_rows,
        preview.error_rows,
        preview.date_from.as_deref(),
        preview.date_to.as_deref(),
        preview.expense_total_cents,
        preview.income_total_cents,
        preview
            .currencies
            .first()
            .map(String::as_str)
            .unwrap_or("RUB"),
    )
    .map_err(|e| e.to_string())?;

    for row in &rows {
        queries::upsert_finance_transaction(
            &conn,
            &row.source,
            &row.source_fingerprint,
            batch.id,
            &row.operation_at,
            &row.payment_date,
            &row.card_mask,
            &row.status,
            row.amount_cents,
            &row.currency,
            row.operation_amount_cents,
            &row.operation_currency,
            row.payment_amount_cents,
            &row.payment_currency,
            row.cashback_cents,
            &row.bank_category,
            &row.mcc,
            &row.description,
            row.bonuses_cents,
            row.invest_rounding_cents,
            row.rounded_amount_cents,
            &row.raw_json,
        )
        .map_err(|e| e.to_string())?;
    }

    let mut mapped_rows = 0;
    for rule in queries::list_finance_mapping_rules(&conn).map_err(|e| e.to_string())? {
        if rule.is_enabled {
            mapped_rows += queries::apply_finance_mapping_rule(&conn, rule.id.unwrap_or(0), false)
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(FinanceImportResult {
        batch_id: batch.id,
        preview,
        mapped_rows,
    })
}

#[tauri::command]
pub fn list_finance_transactions(
    state: State<DbState>,
    plan_id: Option<i64>,
    unmapped_only: Option<bool>,
) -> Result<Vec<FinanceTransaction>, String> {
    let conn = state.lock_recover();
    queries::list_finance_transactions(&conn, plan_id, unmapped_only.unwrap_or(false))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_finance_transaction_allocations(
    state: State<DbState>,
    plan_id: Option<i64>,
) -> Result<Vec<FinanceTransactionAllocation>, String> {
    let conn = state.lock_recover();
    if let Some(plan_id) = plan_id {
        queries::list_finance_transaction_allocations(&conn, plan_id).map_err(|e| e.to_string())
    } else {
        queries::list_all_finance_transaction_allocations(&conn).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn list_finance_mapping_rules(
    state: State<DbState>,
) -> Result<Vec<FinanceMappingRule>, String> {
    let conn = state.lock_recover();
    queries::list_finance_mapping_rules(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_finance_mapping_rule(
    state: State<DbState>,
    name: String,
    is_enabled: bool,
    priority: i64,
    match_mode: String,
    conditions_json: String,
    target_plan_id: i64,
    target_item_id: Option<i64>,
) -> Result<FinanceMappingRule, String> {
    let conn = state.lock_recover();
    let priority = i32::try_from(priority).map_err(|_| "priority is out of range".to_string())?;
    queries::create_finance_mapping_rule(
        &conn,
        &name,
        is_enabled,
        priority,
        &match_mode,
        &conditions_json,
        target_plan_id,
        target_item_id,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_finance_mapping_rule(
    state: State<DbState>,
    id: i64,
    name: String,
    is_enabled: bool,
    priority: i64,
    match_mode: String,
    conditions_json: String,
    target_plan_id: i64,
    target_item_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.lock_recover();
    let priority = i32::try_from(priority).map_err(|_| "priority is out of range".to_string())?;
    queries::update_finance_mapping_rule(
        &conn,
        id,
        &name,
        is_enabled,
        priority,
        &match_mode,
        &conditions_json,
        target_plan_id,
        target_item_id,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_finance_mapping_rule(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::delete_finance_mapping_rule(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn apply_finance_mapping_rule(
    state: State<DbState>,
    id: i64,
    remap_assigned: Option<bool>,
) -> Result<i64, String> {
    let conn = state.lock_recover();
    queries::apply_finance_mapping_rule(&conn, id, remap_assigned.unwrap_or(false))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn assign_finance_transaction(
    state: State<DbState>,
    transaction_id: i64,
    plan_id: i64,
    item_id: Option<i64>,
    rules_locked: Option<bool>,
) -> Result<FinanceTransactionAllocation, String> {
    let conn = state.lock_recover();
    let allocation = queries::create_finance_transaction_allocation(
        &conn,
        transaction_id,
        plan_id,
        item_id,
        "manual",
        None,
    )
    .map_err(|e| e.to_string())?;
    if let Some(rules_locked) = rules_locked {
        queries::set_finance_transaction_rules_locked(&conn, transaction_id, rules_locked)
            .map_err(|e| e.to_string())?;
    }
    Ok(allocation)
}

#[tauri::command]
pub fn set_finance_transaction_rules_locked(
    state: State<DbState>,
    transaction_id: i64,
    rules_locked: bool,
) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::set_finance_transaction_rules_locked(&conn, transaction_id, rules_locked)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_TBANK_CSV: &str = "\"Дата операции\";\"Дата платежа\";\"Номер карты\";\"Статус\";\"Сумма операции\";\"Валюта операции\";\"Сумма платежа\";\"Валюта платежа\";\"Кэшбэк\";\"Категория\";\"MCC\";\"Описание\";\"Бонусы (включая кэшбэк)\";\"Округление на инвесткопилку\";\"Сумма операции с округлением\"\n\"30.04.2026 17:38:55\";\"30.04.2026\";\"*7857\";\"OK\";\"-506,00\";\"RUB\";\"-506,00\";\"RUB\";\"25,00\";\"Такси\";\"3990\";\"Яндекс Такси\";\"25,00\";\"94,00\";\"-600,00\"\n\"24.04.2026 08:14:42\";\"24.04.2026\";\"*7857\";\"OK\";\"181,00\";\"RUB\";\"181,00\";\"RUB\";\"-9,00\";\"Такси\";\"3990\";\"Яндекс Такси\";\"-9,00\";\"0,00\";\"181,00\"\n";

    #[test]
    fn test_parse_tbank_csv_uses_payment_amount_and_decimal_comma() {
        let rows = parse_tbank_csv(SAMPLE_TBANK_CSV).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].operation_at, "2026-04-30 17:38:55");
        assert_eq!(rows[0].payment_date, "2026-04-30");
        assert_eq!(rows[0].amount_cents, -50600);
        assert_eq!(rows[0].payment_amount_cents, -50600);
        assert_eq!(rows[0].cashback_cents, Some(2500));
        assert_eq!(rows[0].bank_category, "Такси");
        assert_eq!(rows[0].mcc, "3990");
        assert_eq!(rows[1].amount_cents, 18100);
        assert_eq!(rows[1].cashback_cents, Some(-900));
    }

    #[test]
    fn test_parse_tbank_csv_uses_operation_date_when_payment_date_is_empty() {
        let csv = SAMPLE_TBANK_CSV.replace("\"30.04.2026\";\"*7857\"", "\"\";\"*7857\"");
        let rows = parse_tbank_csv(&csv).unwrap();
        assert_eq!(rows[0].operation_at, "2026-04-30 17:38:55");
        assert_eq!(rows[0].payment_date, "2026-04-30");
    }

    #[test]
    fn test_parse_tbank_csv_error_includes_column_value_and_raw_row() {
        let bad_row = "\"30.04.2026 17:38:55\";\"not-a-date\";\"*7857\";\"OK\";\"-506,00\";\"RUB\";\"-506,00\";\"RUB\";\"25,00\";\"Такси\";\"3990\";\"Яндекс Такси\";\"25,00\";\"94,00\";\"-600,00\"";
        let csv = format!(
            "{}\n{}\n",
            SAMPLE_TBANK_CSV.lines().next().unwrap(),
            bad_row
        );
        let error = parse_tbank_csv(&csv).unwrap_err();
        assert!(error.contains("invalid payment date: not-a-date"), "{error}");
        assert!(error.contains("Column: Дата платежа"), "{error}");
        assert!(error.contains("Value: not-a-date"), "{error}");
        assert!(error.contains("CSV row 2:"), "{error}");
        assert!(error.contains(bad_row), "{error}");
    }

    #[test]
    fn test_parse_tbank_csv_fingerprint_is_stable_and_distinct() {
        let first = parse_tbank_csv(SAMPLE_TBANK_CSV).unwrap();
        let second = parse_tbank_csv(SAMPLE_TBANK_CSV).unwrap();
        assert_eq!(first[0].source_fingerprint, second[0].source_fingerprint);
        assert_ne!(first[0].source_fingerprint, first[1].source_fingerprint);
    }
}
