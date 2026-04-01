1. запускаю модуль парсинга SQL, отдаю ему вот такой даг:
```
import logging as log
from datetime import datetime, timedelta
from airflow.models import DAG
from airflow.operators.python import PythonOperator
from utils.data_exchange import copy_to_kh_csv
from utils.db.clickhouse.partitions import switch_last_partitions as ch_switch_last_partitions
from utils.decorators_with_conn import with_db, load_and_save_cutoff


GP_CONN_ID = 'do-greenplum'
CH_CONN_ID = 'do-ch-deliverytime'
TELEGA = '@i_sterkhov'
UPDATE_DEPTH = 2 # глубина обновления агрегированных витрин по create_dt, 2 - это текущий месяц и прошлый. Также используется для витрины долгих сридов

""" GP детальная витрина по заказм в пути """
GP_SPEED = 'datamart.orders_delivery_times'
GP_SPEED_BUF = 'buffer_datamart.orders_delivery_times'
GP_SPEED_BUF_TRUNC = 'truncate table buffer_datamart.orders_delivery_times'
GP_SPEED_BUF_INSERT = '''
    --получаем список изменившихся ридов по отсечке.
    --Если отсечка ранее 30 дней до текущего момента, то используется core_wh.shk_event_log_kafka, иначе используется core_wh.shk_event_log_7days_rid
    drop table if exists list_rid_0;
    create temporary table list_rid_0
    with (appendonly = true, orientation = column, compresslevel = 5, compresstype = zstd)
    as (
        select distinct rid
        from core_wh.shk_event_log_7days_rid
        where dwh_date >= %(cutoff)s::timestamp
           and (action_id <= 220 or action_id in (300, 304, 306))
           and %(cutoff)s::timestamp >= now() - interval '31 day'
    
        union all
    
        select distinct rid
        from core_wh.shk_event_log_kafka
        where dwh_date >= %(cutoff)s::timestamp
              and %(cutoff)s::timestamp < now() - interval '31 day'
              and (action_id <= 220 or action_id in (300, 304, 306))
              and dt >= '20220701'
        )
    distributed by (rid) ;
    
    drop table if exists list_rid;
    create temporary table list_rid
    with (appendonly = true, orientation = column, compresslevel = 5, compresstype = zstd)
    as (select rid
        from datamart.positions_changes_rid_price s
        where create_dt >= now() - interval '1 YEAR'
              and exists(select 1 from list_rid_0 where list_rid_0.rid = s.rid)
              and payment_type not like 'S%%'
    )
    distributed by (rid) ;
    
    --DataOps-8387 : список СЦ Армеии и Узбекистана.
    drop table if exists off_list_Armenya_Uzb;
    create temporary table off_list_Armenya_Uzb
    with (appendonly = true, orientation = column, compresslevel = 5, compresstype = zstd)
    as (select office_id
        from dwh.dict.branch_offices
        where country_id in (1051, 1860)
          and type_point in (11, 12, 13, 16, 17))
    distributed by (office_id) ;

    insert into buffer_datamart.orders_delivery_times
    ( rid, srid, src_office_id, poo_office_id, lm_office_id, create_dt,
      ts0, ts1, ts2, ts3, ts4, ts5, ts6, ts7, ts8, ts9,
      ts0_dur, ts1_dur, ts2_dur, ts3_dur, ts4_dur, ts5_dur, ts6_dur, ts7_dur, ts68_dur, ts9_dur,
      ts_rid_history )
    select rid,
        srid,
        src_office_id,
        poo_office_id,
        lm_office_id,
        create_dt,

        max(ts_end) filter ( where ts_type_id = 0 and ts_type_id_next = 1 ) as ts0,
        max(ts_end) filter ( where ts_type_id = 1 and ts_type_id_next = 2 ) as ts1,
        max(ts_end) filter ( where ts_type_id = 2 and ts_type_id_next = 3 ) as ts2,
        max(ts_end) filter ( where ts_type_id = 3 and ts_type_id_next = 4 ) as ts3,
        max(ts_end) filter ( where ts_type_id = 4 and ts_type_id_next = 5 ) as ts4,
        max(ts_end) filter ( where ts_type_id = 5 and ts_type_id_next in (3,6) ) as ts5,
        max(ts_end) filter ( where ts_type_id = 6 and ts_type_id_next = 7 ) as ts6,
        max(ts_end) filter ( where ts_type_id = 7 and ts_type_id_next = 8 ) as ts7,
        max(ts8_poo_accepted_min) as ts8, --max здесь не играет роли, см. ниже, там ts8_poo_accepted_min - уже результат min агрегации по риду
        max(ts9_on_shelf_min) as ts9, --max здесь не играет роли, см. ниже, там ts8_poo_accepted_min - уже результат min агрегации по риду

        sum(extract('epoch' from (ts_end - ts_start ))) filter ( where ts_type_id = 0 and ts_type_id_next = 1 ) as ts0_dur,
        sum(extract('epoch' from (ts_end - ts_start ))) filter ( where ts_type_id = 1 and ts_type_id_next = 2 ) as ts1_dur,
        sum(extract('epoch' from (ts_end - ts_start ))) filter ( where ts_type_id = 2 and ts_type_id_next = 3 ) as ts2_dur,
        sum(extract('epoch' from (ts_end - ts_start ))) filter ( where ts_type_id = 3 and ts_type_id_next = 4 ) as ts3_dur,
        sum(extract('epoch' from (ts_end - ts_start ))) filter ( where ts_type_id = 4 and ts_type_id_next = 5 ) as ts4_dur,
        sum(extract('epoch' from (ts_end - ts_start ))) filter ( where ts_type_id = 5 and ts_type_id_next in (3,6) ) as ts5_dur,
        sum(extract('epoch' from (ts_end - ts_start ))) filter ( where ts_type_id = 6 and ts_type_id_next = 7 ) as ts6_dur,
        sum(extract('epoch' from (ts_end - ts_start ))) filter ( where ts_type_id = 7 and ts_type_id_next = 8 ) as ts7_dur,
        sum(extract('epoch' from (ts_end - ts_start ))) filter ( where ts_type_id = 6 and ts_type_id_next = 8 ) as ts68_dur,
        extract('epoch' from (max(ts9_on_shelf_min) - max(ts8_poo_accepted_min))) as ts9_dur,

        json_agg(json_build_object(
                'rn', rn, 'tt', ts_type_id, 'ttn', ts_type_id_next,
                'ts', extract(epoch from ts_start),
                'te', extract(epoch from ts_end),
                'office_id', office_id
                ) order by rn
                )::jsonb as json
    from (
        select rid,
            srid,
            ts_type_id,
            ts_type_seq,
            max(poo_office_id) as poo_office_id,
            max(src_office_id) as src_office_id,
            max(lm_office_id)  as lm_office_id,
            max(create_dt) as create_dt,
            min(ts) as ts_start,
            max(case when ts_type_id_next_immediate != ts_type_id then ts_next_immediate end) as ts_end,
            max(case when ts_type_id_next_immediate != ts_type_id then ts_type_id_next_immediate end) as ts_type_id_next,
            max(case when ts_type_id_next_immediate != ts_type_id then office_id end) as office_id,
            row_number() over (partition by rid order by ts_type_seq) as rn,
            max(ts8_poo_accepted_min) as ts8_poo_accepted_min,
            max(ts9_on_shelf_min) as ts9_on_shelf_min
        from (select rid,
                    srid,
                    ts,
                    office_id,
                    office_type,
                    office_name,
                    poo_office_id,
                    src_office_id,
                    create_dt,
                    action_id,
                    ts_type_id,
                    dense_rank() over w_rid_ord -
                        dense_rank() over w_rid_tstype_ord as ts_type_seq,
                    lead(ts_type_id) over w_rid_ord        as ts_type_id_next_immediate,
                    lead(ts) over w_rid_ord                as ts_next_immediate,
                    max(lm_office_id) over w_rid           as lm_office_id,
                    ts8_poo_accepted_min,
                    ts9_on_shelf_min
            from (select rid
                        , srid
                        , ts
                        , office_id
                        , office_type
                        , office_name
                        , poo_office_id
                        , src_office_id
                        , create_dt
                        , action_id
                        , office_id_next
                        , case
                              when action_id in (-300,300,304,306) then 0 --'ts0_order_created'
                              when action_id in (10, 1, 2) then 1 --'ts1_onWH_start_froming' -- создан сборончый лист = отправлен на сборку
                              when action_id = 12 then 2 --'ts2_onWH_forming'
                              --when action_id = 115 then 4 --'ts4_onWay_toSC'
                              when action_id in (31, 44, 115, 100, 103, 105, 106) then 5 --'ts5_onSC_accepted'
                              when action_id in (107, 108, 33, 13, 27, 28, 35) and office_id in (select office_id from off_list_Armenya_Uzb)
                                  then 5 --DataOps-8387 в Армении и Узбекистане 3 и 6 заменяем на 5, тк 5 они не присылают
                              when action_id in (107, 108, 33, 13, 27, 28, 35) and office_id_next != poo_office_id
                                  then 3 --'ts3_onSC_sorted_toSC'
                              when action_id in (107, 108, 33, 13, 27, 28, 35) and office_id_next = poo_office_id
                                  then 6 --'ts6_onSC_sorted_toPOO'
                              when action_id in (110, 111, 112, 113, 120, 125, 130) and office_id_next != poo_office_id
                                  then 4 --'ts4_onWay_toSC' --4 ''Отгружен на СЦ'
                              when action_id in (110, 111, 112, 113, 120, 125, 130) and office_id_next = poo_office_id
                                  then 7 --'ts7_onWay_toPOO' --7 'Отгружен на ПВЗ'
                              when action_id in (135, 200) and q2.office_id = q2.poo_office_id
                                  then 8 --'ts8_onPOO_accepted' --8 ''Ожидает раскладки на полку'
                              when action_id in (210, 220) and q2.office_id = q2.poo_office_id
                                  then 9 --'ts8_onPOO_accepted' --8 ''Раскладка на полку'
                              when action_id = 36 then 100 --'ts9_inSearch' --9
                              else 0 --'NA'
                          end::smallint as ts_type_id
                        , case when office_id_next = poo_office_id then office_id end as lm_office_id
                        , ts8_poo_accepted_min
                        , ts9_on_shelf_min
                    from (select rid
                            , srid
                            , ts
                            , office_id
                            , office_type
                            , office_name
                            , poo_office_id
                            , src_office_id
                            , create_dt
                            , action_id
                            , action_description
                            , dwh_date
                            , src
                            , max(case when office_id_next_immediate != office_id then office_id_next_immediate end)
                                    over w_rid_office_seq as office_id_next
                            , min(case when action_id in (135,200) and office_id = poo_office_id then ts end) over w_rid as ts8_poo_accepted_min
                            , min(case when action_id in (210, 220) and office_id = poo_office_id then ts end) over w_rid as ts9_on_shelf_min

                        from (select s.rid
                                    , srid
                                    , ts
                                    , o.main_office_id as office_id
                                    , o.office_type
                                    , o.office_name
                                    , max(dst_office_id) over w_rid as poo_office_id
                                    , max(src_office_id) over w_rid as src_office_id
                                    , max(create_dt) over w_rid as create_dt
                                    , s.action_id
                                    , al.action_description
                                    , s.dwh_date
                                    , s.src
                                    , dense_rank() over w_rid_ord -
                                        dense_rank() over w_rid_office_ord as seq
                                    , lead(s.office_id) over w_rid_ord   as office_id_next_immediate
                                from (select ts + interval '3 hour' as ts
                                            , action_id
                                            , office_id
                                            , rid
                                            , srid
                                            , dwh_date
                                            --dt
                                            , 'selk' as src
                                            , null as src_office_id
                                            , null as dst_office_id
                                            , null as create_dt
                                    from core_wh.shk_event_log_kafka s
                                    where 1=1
                                            and exists(select 1 from list_rid where list_rid.rid = s.rid)
                                            and dt >= now() - interval '1 YEAR'

                                    union all

                                    select ts + interval '3 hour' as ts
                                            , action_id
                                            , office_id
                                            , rid
                                            , srid
                                            , dwh_date
                                            , 'addon' as src
                                            , null as src_office_id
                                            , null as dst_office_id
                                            , null as create_dt
                                    from core_wh.shk_event_log_addon s
                                    where dt >= now() - interval '1 YEAR'
                                            and exists(select 1 from list_rid where list_rid.rid = s.rid)

                                    union all

                                    select create_dt as ts
                                        , -300::int as action_id
                                        , src_office_id as office_id
                                        , rid
                                        , srid
                                        , dwh_date
                                        --create_dt::date as dt
                                        , 'pos_ord' as src
                                        , src_office_id
                                        , dst_office_id
                                        , create_dt
                                    from stage_nats.position_order_rid s
                                    where create_dt >= now() - interval '1 YEAR'
                                            and exists(select 1 from list_rid where list_rid.rid = s.rid)
                                ) s
                                left join dict.action_list al on al.action_id = s.action_id
                                left join dict.branch_office o on o.office_id = s.office_id
                                window w_rid as             (partition by rid)
                                    , w_rid_ord as         (partition by s.rid order by ts, s.action_id)
                                    , w_rid_office_ord as  (partition by s.rid, o.main_office_id order by ts, s.action_id)
                        ) q1
                        where create_dt is not null
                        window w_rid as (partition by rid)
                            , w_rid_office_seq as (partition by rid, office_id, seq)
                    ) q2
                    --берем только ту историю по риду, которая до 1й отметки принятия на ПВЗ или до 1й отметки выкладки на полку на ПВЗ
                    --если нет ни одной отметки,то берем всю историю (так будет повторяться при каждому запуске дага пока не появится одна из отметок)
                    where ts <= greatest(ts8_poo_accepted_min, ts9_on_shelf_min)
                          or greatest(ts8_poo_accepted_min, ts9_on_shelf_min) is null
            ) q3
            window w_rid as (partition by rid)
                , w_rid_ord as (partition by rid order by ts, action_id)
                , w_rid_tstype_ord as (partition by rid, ts_type_id order by ts, action_id)
        ) q4
        group by rid, srid, ts_type_id, ts_type_seq
    ) q5
    group by rid, srid, src_office_id, poo_office_id, lm_office_id, create_dt
    ;
'''

""" CHDM основная витрина на клике - по ридам """
CHDM_SPEED = 'datamart.orders_delivery_times'
CHDM_SPEED_BUF = 'buffer.orders_delivery_times'
CHDM_SPEED_LONG = 'datamart.orders_delivery_times_long_srids'

CHDM_SPEED_COLUMNS = 'rid, srid, src_office_id, poo_office_id, lm_office_id, create_dt, ts0, ts1, ts2, ts3, ts4, ts5, ts6, ts7, ts8, ts9, ts0_dur, ts1_dur, ts2_dur, ts3_dur, ts4_dur, ts5_dur, ts6_dur, ts7_dur, ts68_dur, ts_rid_history'
CHDM_SPEED_INSERT = '''
insert into datamart.orders_delivery_times
(rid, srid, src_office_id, poo_office_id, region_name, country_name, lm_office_id, create_dt,
 ts0, ts1, ts2, ts3, ts4, ts5, ts6, ts7, ts8, ts9,
 ts0_dur, ts1_dur, ts2_dur, ts3_dur, ts4_dur, ts5_dur, ts6_dur, ts7_dur, ts68_dur, dwh_date,
 ts_rid_history.rid_rn, ts_rid_history.ts_type, ts_rid_history.ts_type_next, ts_rid_history.ts_start, ts_rid_history.ts_end, ts_rid_history.office_id
 )
with (JSONExtract(ts_rid_history,'Array(Tuple(rn UInt8, tt UInt8, ttn UInt8, ts UInt32, te UInt32, office_id UInt64))')) as arr
select
 rid, srid, src_office_id, poo_office_id,
 coalesce(nullIf(dictGet('dict.branch_office', 'region_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as region_name,
 coalesce(nullIf(dictGet('dict.branch_office', 'country_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as country_name,
 lm_office_id, create_dt,
 ts0, ts1, ts2, ts3, ts4, ts5, ts6, ts7, ts8, ts9,
 ts0_dur, ts1_dur, ts2_dur, ts3_dur, ts4_dur, ts5_dur, ts6_dur, ts7_dur, ts68_dur, dwh_date,
 arr.1 as rid_rn,
 arr.2 as ts_type,
 arr.3 as ts_type_next,
 arr.4 as ts,
 arr.5 as te_str,
 arr.6 as office_id
from  buffer.orders_delivery_times
;
'''

CHDM_SPEED_LONG_INSERT = '''
insert into datamart.orders_delivery_times_long_srids
(rid, srid, src_office_id, poo_office_id, region_name, country_name, lm_office_id, create_dt,
 ts0, ts1, ts2, ts3, ts4, ts5, ts6, ts7, ts8, ts9,
 ts0_dur, ts1_dur, ts2_dur, ts3_dur, ts4_dur, ts5_dur, ts6_dur, ts7_dur, ts68_dur, dwh_date, is_agg)
select
 rid, srid, src_office_id, poo_office_id,
 coalesce(nullIf(dictGet('dict.branch_office', 'region_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as region_name,
 coalesce(nullIf(dictGet('dict.branch_office', 'country_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as country_name,
 lm_office_id, create_dt,
 ts0, ts1, ts2, ts3, ts4, ts5, ts6, ts7, ts8, ts9,
 ts0_dur, ts1_dur, ts2_dur, ts3_dur, ts4_dur, ts5_dur, ts6_dur, ts7_dur, ts68_dur, dwh_date,
 0 as is_agg
from  buffer.orders_delivery_times
where create_dt < toStartOfMonth(today()) - interval (%(update_depth)s - 1) month
;
'''

CHDM_SPEED_LONG_UODATE = '''
insert into datamart.orders_delivery_times_long_srids
select rid, srid, src_office_id, poo_office_id, region_name, country_name, lm_office_id, create_dt,
 ts0, ts1, ts2, ts3, ts4, ts5, ts6, ts7, ts8, ts9,
 ts0_dur, ts1_dur, ts2_dur, ts3_dur, ts4_dur, ts5_dur, ts6_dur, ts7_dur, ts68_dur, dwh_date,
 1 as is_agg
from datamart.orders_delivery_times_long_srids
where create_dt >= toStartOfMonth(today()) - interval (%(update_depth)s - 1) month
;
'''

""" Скрипты для агрегированной витрины по офисам, в которой настроены проекции и которая используется для отчетов
    1м шагом обновляем предагрегированная витрину с партиционированием (по году-месяцу создания заказа), служит для попартиционной агрегации в отчетную витрину """
CHDM_SPEED_OFFICES_BUF_INSERT_PARTS = '''
insert into buffer.orders_delivery_times_agr_offices
(region_name, country_name, poo_office_id, poo_office_name, msr_id, date, dur_sum, rid_count, rv, partition_key, poo_type, is_mp, is_avia, src_country_name)
select
 region_name, country_name, poo_office_id, poo_office_name, msr_id, date, dur_sum, rid_count, rv, partition_key, poo_type, is_mp, is_avia, src_country_name
from (
    select    coalesce(nullIf(dictGet('dict.branch_office', 'country_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as country_name,
              coalesce(nullIf(dictGet('dict.branch_office', 'region_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as region_name,
              dictGetOrDefault('dict.branch_office', 'country_name',
                toUInt64( dictGetOrDefault('dict.branch_office', 'main_office_id', toUInt64(src_office_id), src_office_id) )
                , 'НЕ ОПРЕДЕЛЕНО') as src_country_name,
              poo_office_id,
              dictGet('dict.branch_office', 'type_point', poo_office_id) as type_point,
              multiIf(
                type_point IN (1, 10, 34), 'собственный',
                type_point IN (5, 6, 7), 'франшизный',
                type_point IN (8, 9), 'партнерский',
                type_point IN (14), 'почта',
                'другое') AS poo_type ,
              dictGet('dict.suppliers_warehouse', 'supplier_id', toInt64(src_office_id)) != 0 ? True : False as is_mp,
              dictGet('dict.office_links', 'is_avia', poo_office_id) as is_avia,
              dictGet('dict.branch_office', 'office_name', poo_office_id) as poo_office_name,
              --toDate(create_dt) create_dt,
              msr_id,
              toDate(case
                        when msr_id = 01 then ts0
                        when msr_id = 12 then ts1
                        when msr_id = 23 then ts2
                        when msr_id = 34 then ts3
                        when msr_id = 45 then ts4
                        when msr_id = 56 then ts5
                        when msr_id = 67 then ts6
                        when msr_id = 78 then ts8
                        when msr_id = 68 then ts8
                        when msr_id = 89 then ts9
                        when msr_id = 09 then ts9
                        when msr_id = 02 then ts1
                       end) as date,
              sum(case
                    when msr_id = 01 then ts0_dur
                    when msr_id = 12 then ts1_dur
                    when msr_id = 23 then ts2_dur
                    when msr_id = 34 then ts3_dur
                    when msr_id = 45 then ts4_dur
                    when msr_id = 56 then ts5_dur
                    when msr_id = 67 then ts6_dur
                    when msr_id = 78 then ts7_dur
                    when msr_id = 68 then coalesce(ts6_dur,0) + coalesce(ts7_dur,0) + coalesce(ts68_dur,0)
                    when msr_id = 89 and toYear(ts9)!=1970 and toYear(ts8)!=1970 then ts9 - ts8
                    when msr_id = 09 and toYear(ts9)!=1970 and toYear(create_dt)!=1970 then ts9 - create_dt
                    when msr_id = 02 and toYear(ts1)!=1970 and toYear(create_dt)!=1970 then ts1 - create_dt
                   end) as dur_sum,
              sum(case
                    when msr_id = 01 and ts0_dur > 0 then 1
                    when msr_id = 12 and ts1_dur > 0 then 1
                    when msr_id = 23 and  ts2_dur > 0 then 1
                    when msr_id = 34 and ts3_dur > 0  then 1
                    when msr_id = 45 and ts4_dur > 0  then 1
                    when msr_id = 56 and  ts5_dur > 0 then 1
                    when msr_id = 67 and ts6_dur > 0 then 1
                    when msr_id = 78 and ts7_dur > 0 then 1
                    when msr_id = 68 and coalesce(ts6_dur,0) + coalesce(ts7_dur,0) + coalesce(ts68_dur,0) > 0 then 1
                    when msr_id = 89 and toYear(ts9)!=1970 and toYear(ts8)!=1970 then 1
                    when msr_id = 09 and toYear(ts9)!=1970 and toYear(create_dt)!=1970 then 1
                    when msr_id = 02 and toYear(ts1)!=1970 and toYear(create_dt)!=1970 then 1
                   end) as rid_count,
              -- max(dwh_date) as dwh_date,
              nowInBlock() as rv,
              toYYYYMM(create_dt) as partition_key
    from datamart.orders_delivery_times final
    array join [01,12,23,34,45,56,67,78,68,89,09,02] as msr_id
    where date is not null and toYear(date)>1970
         and partition_key = %(partition_key)s
--            and partition_key = 202506
    group by msr_id, date, poo_office_id, country_name, region_name, src_country_name, is_mp, partition_key
    settings max_memory_usage = '100Gi'
           , max_bytes_before_external_group_by = '50Gi'
);
'''

CHDM_SPEED_OFFICES_BUF_TS9_INSERT_PARTS = '''
insert into buffer.orders_delivery_times_agr_offices_ts9
(region_name, country_name, poo_office_id, poo_office_name, msr_id, date, dur_sum, rid_count, rv, partition_key, poo_type, is_mp, is_avia, src_country_name)
select
 region_name, country_name, poo_office_id, poo_office_name, msr_id, date, dur_sum, rid_count, rv, partition_key, poo_type, is_mp, is_avia, src_country_name
from (
    select    coalesce(nullIf(dictGet('dict.branch_office', 'country_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as country_name,
              coalesce(nullIf(dictGet('dict.branch_office', 'region_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as region_name,
              dictGetOrDefault('dict.branch_office', 'country_name',
                toUInt64( dictGetOrDefault('dict.branch_office', 'main_office_id', toUInt64(src_office_id), src_office_id) )
                , 'НЕ ОПРЕДЕЛЕНО') as src_country_name,
              poo_office_id,
              dictGet('dict.branch_office', 'type_point', poo_office_id) as type_point,
              multiIf(
                type_point IN (1, 10, 34), 'собственный',
                type_point IN (5, 6, 7), 'франшизный',
                type_point IN (8, 9), 'партнерский',
                type_point IN (14), 'почта',
                'другое') AS poo_type ,
              dictGet('dict.suppliers_warehouse', 'supplier_id', toInt64(src_office_id)) != 0 ? True : False as is_mp,
              dictGet('dict.office_links', 'is_avia', poo_office_id) as is_avia,
              dictGet('dict.branch_office', 'office_name', poo_office_id) as poo_office_name,
              --toDate(create_dt) create_dt,
              msr_id,
              toDate(ts9) as date,
              sum(case
                    when msr_id = 01 then ts0_dur
                    when msr_id = 12 then ts1_dur
                    when msr_id = 23 then ts2_dur
                    when msr_id = 34 then ts3_dur
                    when msr_id = 45 then ts4_dur
                    when msr_id = 56 then ts5_dur
                    when msr_id = 67 then ts6_dur
                    when msr_id = 78 then ts7_dur
                    when msr_id = 68 then coalesce(ts6_dur,0) + coalesce(ts7_dur,0) + coalesce(ts68_dur,0)
                    when msr_id = 89 and toYear(ts9)!=1970 and toYear(ts8)!=1970 then ts9 - ts8
                    when msr_id = 09 and toYear(ts9)!=1970 and toYear(create_dt)!=1970 then ts9 - create_dt
                    when msr_id = 02 and toYear(ts1)!=1970 and toYear(create_dt)!=1970 then ts1 - create_dt
                   end) as dur_sum,
              sum(case
                    when msr_id = 01 and ts0_dur > 0 then 1
                    when msr_id = 12 and ts1_dur > 0 then 1
                    when msr_id = 23 and  ts2_dur > 0 then 1
                    when msr_id = 34 and ts3_dur > 0  then 1
                    when msr_id = 45 and ts4_dur > 0  then 1
                    when msr_id = 56 and  ts5_dur > 0 then 1
                    when msr_id = 67 and ts6_dur > 0 then 1
                    when msr_id = 78 and ts7_dur > 0 then 1
                    when msr_id = 68 and coalesce(ts6_dur,0) + coalesce(ts7_dur,0) + coalesce(ts68_dur,0) > 0 then 1
                    when msr_id = 89 and toYear(ts9)!=1970 and toYear(ts8)!=1970 then 1
                    when msr_id = 09 and toYear(ts9)!=1970 and toYear(create_dt)!=1970 then 1
                    when msr_id = 02 and toYear(ts1)!=1970 and toYear(create_dt)!=1970 then 1
                   end) as rid_count,
              -- max(dwh_date) as dwh_date,
              nowInBlock() as rv,
              toYYYYMM(create_dt) as partition_key
    from datamart.orders_delivery_times final
    array join [01,12,23,34,45,56,67,78,68,89,09,02] as msr_id
    where date is not null and toYear(date)>1970
      and partition_key = %(partition_key)s
--           and partition_key = 202307
    group by country_name, region_name, src_country_name, poo_office_id, is_mp, date, msr_id, partition_key
    settings max_memory_usage = '200Gi'
           , max_bytes_before_external_group_by = '100Gi'
);
'''

CHDM_SPEED_SRC_OFFICES_BUF_INSERT_PARTS = '''
insert into buffer.orders_delivery_times_agr_src_offices
(country_name, region_name, src_country_name, poo_office_id, poo_type, is_mp, is_avia, poo_office_name, msr_id, date, dur_sum, rid_count, dwh_date, rv, partition_key, src_office_id, lm_office_id)
with dictGet('dict.branch_office', 'type_point', poo_office_id) as type_point
select    coalesce(nullIf(dictGet('dict.branch_office', 'country_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as country_name,
          coalesce(nullIf(dictGet('dict.branch_office', 'region_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as region_name,
          dictGetOrDefault('dict.branch_office', 'country_name',
            toUInt64( dictGetOrDefault('dict.branch_office', 'main_office_id', toUInt64(src_office_id), src_office_id) )
            , 'НЕ ОПРЕДЕЛЕНО') as src_country_name,
          poo_office_id,
          multiIf(
            type_point IN (1, 10, 34), 'собственный',
            type_point IN (5, 6, 7), 'франшизный',
            type_point IN (8, 9), 'партнерский',
            type_point IN (14), 'почта',
            'другое') AS poo_type ,
          dictGet('dict.suppliers_warehouse', 'supplier_id', toInt64(src_office_id)) != 0 ? True : False as is_mp,
          dictGet('dict.office_links', 'is_avia', poo_office_id) as is_avia,
          dictGet('dict.branch_office', 'office_name', poo_office_id) as poo_office_name,
          --toDate(create_dt) create_dt,
          msr_id,
          toDate(case
                    when msr_id = 01 then ts0
                    when msr_id = 12 then ts1
                    when msr_id = 23 then ts2
                    when msr_id = 34 then ts3
                    when msr_id = 45 then ts4
                    when msr_id = 56 then ts5
                    when msr_id = 67 then ts6
                    when msr_id = 78 then ts8
                    when msr_id = 68 then ts8
                    when msr_id = 89 then ts9
                    when msr_id = 09 then ts9
                    when msr_id = 02 then ts1
                   end) as date,
          sum(case
                when msr_id = 01 then ts0_dur
                when msr_id = 12 then ts1_dur
                when msr_id = 23 then ts2_dur
                when msr_id = 34 then ts3_dur
                when msr_id = 45 then ts4_dur
                when msr_id = 56 then ts5_dur
                when msr_id = 67 then ts6_dur
                when msr_id = 78 then ts7_dur
                when msr_id = 68 then coalesce(ts6_dur,0) + coalesce(ts7_dur,0) + coalesce(ts68_dur,0)
                when msr_id = 89 and toYear(ts9)!=1970 and toYear(ts8)!=1970 then ts9 - ts8
                when msr_id = 09 and toYear(ts9)!=1970 and toYear(create_dt)!=1970 then ts9 - create_dt
                when msr_id = 02 and toYear(ts1)!=1970 and toYear(create_dt)!=1970 then ts1 - create_dt
               end) as dur_sum,
          sum(case
                when msr_id = 01 and ts0_dur > 0 then 1
                when msr_id = 12 and ts1_dur > 0 then 1
                when msr_id = 23 and  ts2_dur > 0 then 1
                when msr_id = 34 and ts3_dur > 0  then 1
                when msr_id = 45 and ts4_dur > 0  then 1
                when msr_id = 56 and  ts5_dur > 0 then 1
                when msr_id = 67 and ts6_dur > 0 then 1
                when msr_id = 78 and ts7_dur > 0 then 1
                when msr_id = 68 and coalesce(ts6_dur,0) + coalesce(ts7_dur,0) + coalesce(ts68_dur,0) > 0 then 1
                when msr_id = 89 and toYear(ts9)!=1970 and toYear(ts8)!=1970 then 1
                when msr_id = 09 and toYear(ts9)!=1970 and toYear(create_dt)!=1970 then 1
                when msr_id = 02 and toYear(ts1)!=1970 and toYear(create_dt)!=1970 then 1
               end) as rid_count,
          max(dwh_date) as dwh_date,
          nowInBlock() as rv,
          toYYYYMM(create_dt) as partition_key,
          src_office_id,
          lm_office_id
from datamart.orders_delivery_times final
array join [01,12,23,34,45,56,67,78,68,89,09,02] as msr_id
where date is not null and toYear(date)>1970
      and partition_key = %(partition_key)s
--      and partition_key = 202307
group by country_name, region_name, src_country_name, poo_office_id, is_mp, date, msr_id, partition_key, src_office_id, lm_office_id
settings max_memory_usage = '200Gi',
         max_bytes_before_external_group_by = '100Gi'
;'''

CHDM_SPEED_SRC_OFFICES_BUF_TS9_INSERT_PARTS = '''
insert into buffer.orders_delivery_times_agr_src_offices_ts9
(country_name, region_name, src_country_name, poo_office_id, poo_type, is_mp, is_avia, poo_office_name, msr_id, date, dur_sum, rid_count, dwh_date, rv, partition_key, src_office_id, lm_office_id)
with dictGet('dict.branch_office', 'type_point', poo_office_id) as type_point
select    coalesce(nullIf(dictGet('dict.branch_office', 'country_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as country_name,
          coalesce(nullIf(dictGet('dict.branch_office', 'region_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as region_name,
          dictGetOrDefault('dict.branch_office', 'country_name',
            toUInt64( dictGetOrDefault('dict.branch_office', 'main_office_id', toUInt64(src_office_id), src_office_id) )
            , 'НЕ ОПРЕДЕЛЕНО') as src_country_name,
          poo_office_id,
          multiIf(
            type_point IN (1, 10, 34), 'собственный',
            type_point IN (5, 6, 7), 'франшизный',
            type_point IN (8, 9), 'партнерский',
            type_point IN (14), 'почта',
            'другое') AS poo_type ,
          dictGet('dict.suppliers_warehouse', 'supplier_id', toInt64(src_office_id)) != 0 ? True : False as is_mp,
          dictGet('dict.office_links', 'is_avia', poo_office_id) as is_avia,
          dictGet('dict.branch_office', 'office_name', poo_office_id) as poo_office_name,
          --toDate(create_dt) create_dt,
          msr_id,
          toDate(ts9) as date,
          sum(case
                when msr_id = 01 then ts0_dur
                when msr_id = 12 then ts1_dur
                when msr_id = 23 then ts2_dur
                when msr_id = 34 then ts3_dur
                when msr_id = 45 then ts4_dur
                when msr_id = 56 then ts5_dur
                when msr_id = 67 then ts6_dur
                when msr_id = 78 then ts7_dur
                when msr_id = 68 then coalesce(ts6_dur,0) + coalesce(ts7_dur,0) + coalesce(ts68_dur,0)
                when msr_id = 89 and toYear(ts9)!=1970 and toYear(ts8)!=1970 then ts9 - ts8
                when msr_id = 09 and toYear(ts9)!=1970 and toYear(create_dt)!=1970 then ts9 - create_dt
                when msr_id = 02 and toYear(ts1)!=1970 and toYear(create_dt)!=1970 then ts1 - create_dt
               end) as dur_sum,
          sum(case
                when msr_id = 01 and ts0_dur > 0 then 1
                when msr_id = 12 and ts1_dur > 0 then 1
                when msr_id = 23 and  ts2_dur > 0 then 1
                when msr_id = 34 and ts3_dur > 0  then 1
                when msr_id = 45 and ts4_dur > 0  then 1
                when msr_id = 56 and  ts5_dur > 0 then 1
                when msr_id = 67 and ts6_dur > 0 then 1
                when msr_id = 78 and ts7_dur > 0 then 1
                when msr_id = 68 and coalesce(ts6_dur,0) + coalesce(ts7_dur,0) + coalesce(ts68_dur,0) > 0 then 1
                when msr_id = 89 and toYear(ts9)!=1970 and toYear(ts8)!=1970 then 1
                when msr_id = 09 and toYear(ts9)!=1970 and toYear(create_dt)!=1970 then 1
                when msr_id = 02 and toYear(ts1)!=1970 and toYear(create_dt)!=1970 then 1
               end) as rid_count,
          max(dwh_date) as dwh_date,
          nowInBlock() as rv,
          toYYYYMM(create_dt) as partition_key,
          src_office_id,
          lm_office_id
from datamart.orders_delivery_times final
array join [01,12,23,34,45,56,67,78,68,89,09,02] as msr_id
where date is not null and toYear(date)>1970
  and partition_key = %(partition_key)s
--      and partition_key = 202310
group by country_name, region_name, src_country_name, poo_office_id, is_mp, date, msr_id, partition_key, src_office_id, lm_office_id
settings max_memory_usage = '200Gi',
         max_bytes_before_external_group_by = '100Gi'
;'''

CHDM_SPEED_LONG_SRIDS_OFFICES = '''
truncate table datamart.orders_delivery_times_long_srids_agr_offices;
insert into datamart.orders_delivery_times_long_srids_agr_offices
(country_name, region_name, src_country_name, poo_office_id,
 poo_type, is_mp, is_avia, msr_id, date, dur_sum, rid_count)
select
 country_name, region_name, src_country_name, poo_office_id,
 poo_type, is_mp, is_avia, msr_id, date, dur_sum, rid_count
from (
    with dictGet('dict.branch_office', 'type_point', poo_office_id) as type_point
    select    coalesce(nullIf(dictGet('dict.branch_office', 'country_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as country_name,
              coalesce(nullIf(dictGet('dict.branch_office', 'region_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as region_name,
              dictGetOrDefault('dict.branch_office', 'country_name',
                toUInt64( dictGetOrDefault('dict.branch_office', 'main_office_id', toUInt64(src_office_id), src_office_id) )
                , 'НЕ ОПРЕДЕЛЕНО') as src_country_name,
              poo_office_id,
              multiIf(
                type_point IN (1, 10, 34), 'собственный',
                type_point IN (5, 6, 7), 'франшизный',
                type_point IN (8, 9), 'партнерский',
                type_point IN (14), 'почта',
                'другое') AS poo_type ,
              dictGet('dict.suppliers_warehouse', 'supplier_id', toInt64(src_office_id)) != 0 ? True : False as is_mp,
              dictGet('dict.office_links', 'is_avia', poo_office_id) as is_avia,
              msr_id,
              toDate(case
                        when msr_id = 01 then ts0
                        when msr_id = 12 then ts1
                        when msr_id = 23 then ts2
                        when msr_id = 34 then ts3
                        when msr_id = 45 then ts4
                        when msr_id = 56 then ts5
                        when msr_id = 67 then ts6
                        when msr_id = 78 then ts8
                        when msr_id = 68 then ts8
                        when msr_id = 89 then ts9
                        when msr_id = 09 then ts9
                        when msr_id = 02 then ts1
                       end) as date,
              sum(case
                    when msr_id = 01 then ts0_dur
                    when msr_id = 12 then ts1_dur
                    when msr_id = 23 then ts2_dur
                    when msr_id = 34 then ts3_dur
                    when msr_id = 45 then ts4_dur
                    when msr_id = 56 then ts5_dur
                    when msr_id = 67 then ts6_dur
                    when msr_id = 78 then ts7_dur
                    when msr_id = 68 then coalesce(ts6_dur,0) + coalesce(ts7_dur,0) + coalesce(ts68_dur,0)
                    when msr_id = 89 and toYear(ts9)!=1970 and toYear(ts8)!=1970 then ts9 - ts8
                    when msr_id = 09 and toYear(ts9)!=1970 and toYear(create_dt)!=1970 then ts9 - create_dt
                    when msr_id = 02 and toYear(ts1)!=1970 and toYear(create_dt)!=1970 then ts1 - create_dt
                   end) as dur_sum,
              sum(case
                    when msr_id = 01 and ts0_dur > 0 then 1
                    when msr_id = 12 and ts1_dur > 0 then 1
                    when msr_id = 23 and  ts2_dur > 0 then 1
                    when msr_id = 34 and ts3_dur > 0  then 1
                    when msr_id = 45 and ts4_dur > 0  then 1
                    when msr_id = 56 and  ts5_dur > 0 then 1
                    when msr_id = 67 and ts6_dur > 0 then 1
                    when msr_id = 78 and ts7_dur > 0 then 1
                    when msr_id = 68 and coalesce(ts6_dur,0) + coalesce(ts7_dur,0) + coalesce(ts68_dur,0) > 0 then 1
                    when msr_id = 89 and toYear(ts9)!=1970 and toYear(ts8)!=1970 then 1
                    when msr_id = 09 and toYear(ts9)!=1970 and toYear(create_dt)!=1970 then 1
                    when msr_id = 02 and toYear(ts1)!=1970 and toYear(create_dt)!=1970 then 1
                   end) as rid_count
    from datamart.orders_delivery_times_long_srids final
    array join [01,12,23,34,45,56,67,78,68,89,09,02] as msr_id
    where is_agg = 0
    group by country_name, region_name, src_country_name, poo_office_id, is_mp, date, msr_id
    ) q
;

truncate datamart.orders_delivery_times_long_srids_agr_offices_ts9;
insert into datamart.orders_delivery_times_long_srids_agr_offices_ts9
(country_name, region_name, src_country_name, poo_office_id, poo_type, is_mp, is_avia, msr_id, date, dur_sum, rid_count)
select
 country_name, region_name, src_country_name, poo_office_id, poo_type, is_mp, is_avia, msr_id, date, dur_sum, rid_count
from (
    with dictGet('dict.branch_office', 'type_point', poo_office_id) as type_point
    select    coalesce(nullIf(dictGet('dict.branch_office', 'country_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as country_name,
              coalesce(nullIf(dictGet('dict.branch_office', 'region_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as region_name,
              dictGetOrDefault('dict.branch_office', 'country_name',
                toUInt64( dictGetOrDefault('dict.branch_office', 'main_office_id', toUInt64(src_office_id), src_office_id) )
                , 'НЕ ОПРЕДЕЛЕНО') as src_country_name,
              poo_office_id,
              multiIf(
                type_point IN (1, 10, 34), 'собственный',
                type_point IN (5, 6, 7), 'франшизный',
                type_point IN (8, 9), 'партнерский',
                type_point IN (14), 'почта',
                'другое') AS poo_type,
              dictGet('dict.suppliers_warehouse', 'supplier_id', toInt64(src_office_id)) != 0 ? True : False as is_mp,
              dictGet('dict.office_links', 'is_avia', poo_office_id) as is_avia,
              msr_id,
              toDate(ts9) as date,
              sum(case
                    when msr_id = 01 then ts0_dur
                    when msr_id = 12 then ts1_dur
                    when msr_id = 23 then ts2_dur
                    when msr_id = 34 then ts3_dur
                    when msr_id = 45 then ts4_dur
                    when msr_id = 56 then ts5_dur
                    when msr_id = 67 then ts6_dur
                    when msr_id = 78 then ts7_dur
                    when msr_id = 68 then coalesce(ts6_dur,0) + coalesce(ts7_dur,0) + coalesce(ts68_dur,0)
                    when msr_id = 89 and toYear(ts9)!=1970 and toYear(ts8)!=1970 then ts9 - ts8
                    when msr_id = 09 and toYear(ts9)!=1970 and toYear(create_dt)!=1970 then ts9 - create_dt
                    when msr_id = 02 and toYear(ts1)!=1970 and toYear(create_dt)!=1970 then ts1 - create_dt
                   end) as dur_sum,
              sum(case
                    when msr_id = 01 and ts0_dur > 0 then 1
                    when msr_id = 12 and ts1_dur > 0 then 1
                    when msr_id = 23 and  ts2_dur > 0 then 1
                    when msr_id = 34 and ts3_dur > 0  then 1
                    when msr_id = 45 and ts4_dur > 0  then 1
                    when msr_id = 56 and  ts5_dur > 0 then 1
                    when msr_id = 67 and ts6_dur > 0 then 1
                    when msr_id = 78 and ts7_dur > 0 then 1
                    when msr_id = 68 and coalesce(ts6_dur,0) + coalesce(ts7_dur,0) + coalesce(ts68_dur,0) > 0 then 1
                    when msr_id = 89 and toYear(ts9)!=1970 and toYear(ts8)!=1970 then 1
                    when msr_id = 09 and toYear(ts9)!=1970 and toYear(create_dt)!=1970 then 1
                    when msr_id = 02 and toYear(ts1)!=1970 and toYear(create_dt)!=1970 then 1
                   end) as rid_count
    from datamart.orders_delivery_times_long_srids final
    array join [01,12,23,34,45,56,67,78,68,89,09,02] as msr_id
    where is_agg = 0
    group by country_name, region_name, src_country_name, poo_office_id, is_mp, date, msr_id
)
;

truncate datamart.orders_delivery_times_long_srids_agr_src_offices;
insert into datamart.orders_delivery_times_long_srids_agr_src_offices
(region_name, country_name, poo_office_id, msr_id, date, dur_sum, rid_count, poo_type, is_mp, is_avia, src_office_id, lm_office_id, src_country_name)
select
region_name, country_name, poo_office_id, msr_id, date, dur_sum, rid_count, poo_type, is_mp, is_avia, src_office_id, lm_office_id, src_country_name
from (
    with dictGet('dict.branch_office', 'type_point', poo_office_id) as type_point
    select    coalesce(nullIf(dictGet('dict.branch_office', 'country_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as country_name,
              coalesce(nullIf(dictGet('dict.branch_office', 'region_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as region_name,
              dictGetOrDefault('dict.branch_office', 'country_name',
                toUInt64( dictGetOrDefault('dict.branch_office', 'main_office_id', toUInt64(src_office_id), src_office_id) )
                , 'НЕ ОПРЕДЕЛЕНО') as src_country_name,
              poo_office_id,
              multiIf(
                type_point IN (1, 10, 34), 'собственный',
                type_point IN (5, 6, 7), 'франшизный',
                type_point IN (8, 9), 'партнерский',
                type_point IN (14), 'почта',
                'другое') AS poo_type ,
              dictGet('dict.suppliers_warehouse', 'supplier_id', toInt64(src_office_id)) != 0 ? True : False as is_mp,
              dictGet('dict.office_links', 'is_avia', poo_office_id) as is_avia,
              msr_id,
              toDate(case
                        when msr_id = 01 then ts0
                        when msr_id = 12 then ts1
                        when msr_id = 23 then ts2
                        when msr_id = 34 then ts3
                        when msr_id = 45 then ts4
                        when msr_id = 56 then ts5
                        when msr_id = 67 then ts6
                        when msr_id = 78 then ts8
                        when msr_id = 68 then ts8
                        when msr_id = 89 then ts9
                        when msr_id = 09 then ts9
                        when msr_id = 02 then ts1
                       end) as date,
              sum(case
                    when msr_id = 01 then ts0_dur
                    when msr_id = 12 then ts1_dur
                    when msr_id = 23 then ts2_dur
                    when msr_id = 34 then ts3_dur
                    when msr_id = 45 then ts4_dur
                    when msr_id = 56 then ts5_dur
                    when msr_id = 67 then ts6_dur
                    when msr_id = 78 then ts7_dur
                    when msr_id = 68 then coalesce(ts6_dur,0) + coalesce(ts7_dur,0) + coalesce(ts68_dur,0)
                    when msr_id = 89 and toYear(ts9)!=1970 and toYear(ts8)!=1970 then ts9 - ts8
                    when msr_id = 09 and toYear(ts9)!=1970 and toYear(create_dt)!=1970 then ts9 - create_dt
                    when msr_id = 02 and toYear(ts1)!=1970 and toYear(create_dt)!=1970 then ts1 - create_dt
                   end) as dur_sum,
              sum(case
                    when msr_id = 01 and ts0_dur > 0 then 1
                    when msr_id = 12 and ts1_dur > 0 then 1
                    when msr_id = 23 and  ts2_dur > 0 then 1
                    when msr_id = 34 and ts3_dur > 0  then 1
                    when msr_id = 45 and ts4_dur > 0  then 1
                    when msr_id = 56 and  ts5_dur > 0 then 1
                    when msr_id = 67 and ts6_dur > 0 then 1
                    when msr_id = 78 and ts7_dur > 0 then 1
                    when msr_id = 68 and coalesce(ts6_dur,0) + coalesce(ts7_dur,0) + coalesce(ts68_dur,0) > 0 then 1
                    when msr_id = 89 and toYear(ts9)!=1970 and toYear(ts8)!=1970 then 1
                    when msr_id = 09 and toYear(ts9)!=1970 and toYear(create_dt)!=1970 then 1
                    when msr_id = 02 and toYear(ts1)!=1970 and toYear(create_dt)!=1970 then 1
                   end) as rid_count,
              src_office_id,
              lm_office_id
    from datamart.orders_delivery_times_long_srids final
    array join [01,12,23,34,45,56,67,78,68,89,09,02] as msr_id
    where is_agg = 0
    group by country_name, region_name, src_country_name, poo_office_id, is_mp, date, msr_id, src_office_id, lm_office_id
)
;

truncate datamart.orders_delivery_times_long_srids_agr_src_offices_ts9 ;
insert into datamart.orders_delivery_times_long_srids_agr_src_offices_ts9
(region_name, country_name, poo_office_id, msr_id, date, dur_sum, rid_count, poo_type, is_mp, is_avia, src_office_id, lm_office_id, src_country_name)
select
 region_name, country_name, poo_office_id, msr_id, date, dur_sum, rid_count, poo_type, is_mp, is_avia, src_office_id, lm_office_id, src_country_name
from (
    with dictGet('dict.branch_office', 'type_point', poo_office_id) as type_point
    select    coalesce(nullIf(dictGet('dict.branch_office', 'country_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as country_name,
              coalesce(nullIf(dictGet('dict.branch_office', 'region_name', poo_office_id), ''), 'НЕ ОПРЕДЕЛЕНО') as region_name,
              dictGetOrDefault('dict.branch_office', 'country_name',
                toUInt64( dictGetOrDefault('dict.branch_office', 'main_office_id', toUInt64(src_office_id), src_office_id) )
                , 'НЕ ОПРЕДЕЛЕНО') as src_country_name,
              poo_office_id,
              multiIf(
                type_point IN (1, 10, 34), 'собственный',
                type_point IN (5, 6, 7), 'франшизный',
                type_point IN (8, 9), 'партнерский',
                type_point IN (14), 'почта',
                'другое') AS poo_type ,
              dictGet('dict.suppliers_warehouse', 'supplier_id', toInt64(src_office_id)) != 0 ? True : False as is_mp,
              dictGet('dict.office_links', 'is_avia', poo_office_id) as is_avia,
              msr_id,
              toDate(ts9) as date,
              sum(case
                    when msr_id = 01 then ts0_dur
                    when msr_id = 12 then ts1_dur
                    when msr_id = 23 then ts2_dur
                    when msr_id = 34 then ts3_dur
                    when msr_id = 45 then ts4_dur
                    when msr_id = 56 then ts5_dur
                    when msr_id = 67 then ts6_dur
                    when msr_id = 78 then ts7_dur
                    when msr_id = 68 then coalesce(ts6_dur,0) + coalesce(ts7_dur,0) + coalesce(ts68_dur,0)
                    when msr_id = 89 and toYear(ts9)!=1970 and toYear(ts8)!=1970 then ts9 - ts8
                    when msr_id = 09 and toYear(ts9)!=1970 and toYear(create_dt)!=1970 then ts9 - create_dt
                    when msr_id = 02 and toYear(ts1)!=1970 and toYear(create_dt)!=1970 then ts1 - create_dt
                   end) as dur_sum,
              sum(case
                    when msr_id = 01 and ts0_dur > 0 then 1
                    when msr_id = 12 and ts1_dur > 0 then 1
                    when msr_id = 23 and  ts2_dur > 0 then 1
                    when msr_id = 34 and ts3_dur > 0  then 1
                    when msr_id = 45 and ts4_dur > 0  then 1
                    when msr_id = 56 and  ts5_dur > 0 then 1
                    when msr_id = 67 and ts6_dur > 0 then 1
                    when msr_id = 78 and ts7_dur > 0 then 1
                    when msr_id = 68 and coalesce(ts6_dur,0) + coalesce(ts7_dur,0) + coalesce(ts68_dur,0) > 0 then 1
                    when msr_id = 89 and toYear(ts9)!=1970 and toYear(ts8)!=1970 then 1
                    when msr_id = 09 and toYear(ts9)!=1970 and toYear(create_dt)!=1970 then 1
                    when msr_id = 02 and toYear(ts1)!=1970 and toYear(create_dt)!=1970 then 1
                   end) as rid_count,
              src_office_id,
              lm_office_id
    from datamart.orders_delivery_times_long_srids final
    array join [01,12,23,34,45,56,67,78,68,89,09,02] as msr_id
    where is_agg = 0
    group by country_name, region_name, src_country_name, poo_office_id, is_mp, date, msr_id, src_office_id, lm_office_id
)
;
'''

@with_db(GP_CONN_ID, 'gp')
@load_and_save_cutoff(GP_SPEED, 'gp', 'max_dt')
def gp_load_speeds(gp_hook, cutoff):
    """ наполняем буферную таблицу buffer_datamart.orders_delivery_times """
    log.info(f'got cutoff: {cutoff}')
    log.info(GP_SPEED_BUF_INSERT % {'cutoff': cutoff})

    gp_hook.exec_with_log('truncate table buffer_datamart.orders_delivery_times')
    gp_hook.exec_with_log(GP_SPEED_BUF_INSERT, parameters={'cutoff': cutoff})

    co_end = gp_hook.fetchone(''' select max(dwh_date) from buffer_datamart.orders_delivery_times; ''')
    return co_end

@with_db(CH_CONN_ID, 'ch')
def gp_to_dm3_load_buff(ch_hook):
    """ загрузка из ГП в буферку основной витрины на КХ : buffer.orders_delivery_times """

    trunc_chdm_speed_buf = f'SET max_table_size_to_drop = 0; truncate table {CHDM_SPEED_BUF}'
    ch_hook.exec_with_log(trunc_chdm_speed_buf)
    log.info(f'Truncate table done!')

    log.info(f"Start load to CH buffer table: {CHDM_SPEED_BUF}")
    copy_to_kh_csv(src_connection=GP_CONN_ID,
                   dst_connection=CH_CONN_ID,
                   src_table_name=GP_SPEED_BUF,
                   dst_table_name=CHDM_SPEED_BUF,
                   columns=CHDM_SPEED_COLUMNS,
                   need_trunc='yes')
    log.info(f'Load to CH buffer table - done: {CHDM_SPEED_BUF}')


@with_db(CH_CONN_ID)
def dm3_speeds_core(hook, update_depth):
    """ загрузка в основную витрину со сроками : datamart.orders_delivery_times"""
    log.info(f"Start load to CH datamart table: {CHDM_SPEED}")
    hook.exec_with_log(CHDM_SPEED_INSERT)
    log.info(f'Load to CH datamart table - done: {CHDM_SPEED}')

    """ загрузка в витрину с долгими сридами : datamart.orders_delivery_times"""
    log.info(f"Start load to CH datamart table: {CHDM_SPEED_LONG}")
    hook.exec_with_log(CHDM_SPEED_LONG_INSERT, parameters=dict(update_depth=update_depth))
    log.info(f'Load to CH datamart table - done: {CHDM_SPEED_LONG}')


@with_db(CH_CONN_ID)
def dm3_speed_agr_offices(hook, load_type='update', update_depth=2):
    """ Заполняем отчетную витрину, агрегированную по мерам, датам, офисам
        Используем метод попартиционного обновления предагрегированной витрины и дальнейшая доагрегация в отчетную витрину """

    """ шаг 1: orders_delivery_times_agr_offices """
    log.info(f'Filling intermediate buffer table step-by-step by partitions : datamart.orders_delivery_times_agr_offices_partitioned, load_type = {load_type}')
    ch_switch_last_partitions(
        conn_id=CH_CONN_ID,
        table_src='datamart.orders_delivery_times',
        table_buffer='buffer.orders_delivery_times_agr_offices',
        table_dest='datamart.orders_delivery_times_agr_offices',
        table_get_partitions='view (select toDate(today() - interval number month) as create_dt from numbers() limit 100)' if load_type == 'update' else '',
        sql_insert_to_buffer=CHDM_SPEED_OFFICES_BUF_INSERT_PARTS,
        partition_expr='toYYYYMM(create_dt)',
        update_depth=update_depth if load_type == 'update' else 0
    )

    """ апдейтим datamart.orders_delivery_times_long_srids """
    log.info(f'update table, is_agg=1 : datamart.orders_delivery_times_long_srids ')
    hook.exec_with_log(CHDM_SPEED_LONG_UODATE, parameters=dict(update_depth=update_depth))


@with_db(CH_CONN_ID)
def dm3_speed_agr_offices_ts9(hook, load_type='update', update_depth=2):
    """ шаг 2 :orders_delivery_times_agr_offices_ts9 """
    log.info(f'Filling intermediate buffer table step-by-step by partitions : datamart.orders_delivery_times_agr_offices_ts9_partitioned, load_type = {load_type}')
    ch_switch_last_partitions(
        conn_id=CH_CONN_ID,
        table_src='datamart.orders_delivery_times',
        table_buffer='buffer.orders_delivery_times_agr_offices_ts9',
        table_dest='datamart.orders_delivery_times_agr_offices_ts9',
        table_get_partitions='view (select toDate(today() - interval number month) as create_dt from numbers() limit 100)' if load_type == 'update' else '',
        sql_insert_to_buffer=CHDM_SPEED_OFFICES_BUF_TS9_INSERT_PARTS,
        partition_expr='toYYYYMM(create_dt)',
        update_depth=update_depth if load_type == 'update' else 0
    )


@with_db(CH_CONN_ID)
def dm3_speed_agr_src_offices(hook, load_type='update', update_depth=2):
    """ шаг 3: datamart.orders_delivery_times_agr_src_offices"""
    hook.exec_with_log('truncate table buffer.orders_delivery_times_agr_src_offices settings max_table_size_to_drop = 0')
    log.info(f'Filling intermediate buffer table step-by-step by partitions : datamart.orders_delivery_times_agr_src_offices_partitioned, load_type = {load_type}')
    ch_switch_last_partitions(
        conn_id=CH_CONN_ID,
        table_src='datamart.orders_delivery_times',
        table_buffer='buffer.orders_delivery_times_agr_src_offices',
        table_dest='datamart.orders_delivery_times_agr_src_offices',
        table_get_partitions='view (select toDate(today() - interval number month) as create_dt from numbers() limit 100)' if load_type == 'update' else '',
        sql_insert_to_buffer=CHDM_SPEED_SRC_OFFICES_BUF_INSERT_PARTS,
        partition_expr='toYYYYMM(create_dt)',
        update_depth=update_depth if load_type == 'update' else 0
    )

@with_db(CH_CONN_ID)
def dm3_speed_agr_src_offices_ts9(hook, load_type='update', update_depth=2):
    """ шаг 4: datamart.orders_delivery_times_agr_src_offices_ts9"""
    hook.exec_with_log('truncate table buffer.orders_delivery_times_agr_src_offices settings max_table_size_to_drop = 0')
    log.info(f'Filling intermediate buffer table step-by-step by partitions : datamart.orders_delivery_times_agr_src_offices_ts9_partitioned, load_type = {load_type}')
    ch_switch_last_partitions(
        conn_id=CH_CONN_ID,
        table_src='datamart.orders_delivery_times',
        table_buffer='buffer.orders_delivery_times_agr_src_offices_ts9',
        table_dest='datamart.orders_delivery_times_agr_src_offices_ts9',
        table_get_partitions='view (select toDate(today() - interval number month) as create_dt from numbers() limit 100)' if load_type == 'update' else '',
        sql_insert_to_buffer=CHDM_SPEED_SRC_OFFICES_BUF_TS9_INSERT_PARTS,
        partition_expr='toYYYYMM(create_dt)',
        update_depth=update_depth if load_type == 'update' else 0
    )

@with_db(CH_CONN_ID)
def dm3_speed_agr_long_srids(hook):
    log.info('Filling aggregated tables for long srids')
    hook.exec_with_log(CHDM_SPEED_LONG_SRIDS_OFFICES)

with DAG(
        dag_id="gp_to_dm3_orders_delivery_times",
        description=f"Даг формирует витрины для скоростей доставки в2 на ГП и на КХ",
        schedule='10 2 * * *',
        start_date=datetime(2024, 3, 29),
        catchup=False,
        max_active_runs=1,
        tags=["datamart", "orders_delivery_times", TELEGA, GP_CONN_ID, CH_CONN_ID],
        default_args=dict(
            owner='sterhov.igor',
            telegram=[TELEGA],
            catchup=False,
            email_on_failure=True,
            retries=2,
            retry_delay=timedelta(minutes=10)),
) as dag:

    task_gp_load_speeds = PythonOperator(
        task_id="gp_load_speeds",
        dag=dag,
        doc="Формируем буферку на ГП",
        python_callable=gp_load_speeds,
        pool=GP_CONN_ID
    )

    task_gp_to_dm3_load_buff = PythonOperator(
        task_id="gp_to_dm3_load_buff",
        dag=dag,
        doc="копирование данных из таблицы (GP) в буферку основной витрины на do-ch-deliverytime)",
        pool=CH_CONN_ID,
        python_callable=gp_to_dm3_load_buff
    )

    task_dm3_speeds_core = PythonOperator(
        task_id="dm3_speeds_core",
        dag=dag,
        doc="копирование данных из буферки в основную витрину на do-delivery-time",
        pool= CH_CONN_ID,
        python_callable=dm3_speeds_core,
        op_kwargs={'update_depth': UPDATE_DEPTH}
    )

    task_dm3_speed_agr_offices = PythonOperator(
        task_id="dm3_speed_agr_offices",
        dag=dag,
        doc="формирование агрегированной витрины по офисам дял отчетов",
        pool=CH_CONN_ID,
        python_callable=dm3_speed_agr_offices,
        op_kwargs={'load_type':'update', 'update_depth': UPDATE_DEPTH}
    )

    task_dm3_speed_agr_offices_ts9 = PythonOperator(
        task_id="dm3_speed_agr_offices_ts9",
        dag=dag,
        doc="формирование агрегированной витрины по офисам дял отчетов",
        pool=CH_CONN_ID,
        python_callable=dm3_speed_agr_offices_ts9,
        op_kwargs={'load_type':'update', 'update_depth': UPDATE_DEPTH}
    )

    task_dm3_speed_agr_src_offices = PythonOperator(
        task_id="dm3_speed_agr_src_offices",
        dag=dag,
        doc="формирование агрегированной витрины по офисам дял отчетов",
        pool=CH_CONN_ID,
        python_callable=dm3_speed_agr_src_offices,
        op_kwargs={'load_type':'update', 'update_depth': UPDATE_DEPTH}
    )

    task_dm3_speed_agr_src_offices_ts9 = PythonOperator(
        task_id="dm3_speed_agr_src_offices_ts9",
        dag=dag,
        doc="формирование агрегированной витрины по офисам дял отчетов",
        pool=CH_CONN_ID,
        python_callable=dm3_speed_agr_src_offices_ts9,
        op_kwargs={'load_type':'update', 'update_depth': UPDATE_DEPTH}
    )

    task_dm3_speed_agr_long_srids = PythonOperator(
        task_id="dm3_speed_agr_long_srids",
        dag=dag,
        doc="формирование агрегированных витрин по длинным сридам",
        pool=CH_CONN_ID,
        python_callable=dm3_speed_agr_long_srids
    )

    task_gp_load_speeds >> task_gp_to_dm3_load_buff >> task_dm3_speeds_core >> task_dm3_speed_agr_offices
    task_dm3_speed_agr_offices >> task_dm3_speed_agr_offices_ts9 >> task_dm3_speed_agr_src_offices >> task_dm3_speed_agr_src_offices_ts9 >> task_dm3_speed_agr_long_srids
```
получаю вот такой вывод:
```
Matches found: {'buffer_datamart.orders_delivery_times', 'dict.office_links', 'buffer.orders_delivery_times', 'dwh.dict', 'core_wh.shk_event_log_addon', 'airflow.models', 'dict.branch_office', 'utils.decorators_with_conn', 'datamart.orders_delivery_times_long_srids', 'stage_nats.position_order_rid', 'utils.data_exchange', 'utils.db', 'core_wh.shk_event_log_kafka', 'core_wh.shk_event_log_7days_rid', 'dict.suppliers_warehouse', 'dict.action_list', 'airflow.operators', 'datamart.orders_delivery_times', 'datamart.positions_changes_rid_price'}

# Список всех таблиц:
buffer_datamart.orders_delivery_times
buffer.orders_delivery_times
utils.decorators_with_conn
utils.db
core_wh.shk_event_log_kafka
dwh.dict
core_wh.shk_event_log_7days_rid
dict.action_list
datamart.positions_changes_rid_price
airflow.operators
core_wh.shk_event_log_addon
datamart.orders_delivery_times_long_srids
airflow.models
dict.branch_office
datamart.orders_delivery_times
utils.data_exchange
stage_nats.position_order_rid

# Список всех диктов:
dict.branch_office
dict.suppliers_warehouse
dict.office_links
```
как видимшь, найдены не все таблицы, а также видно ложноположительные срабатывания, к примеру 
"utils.data_exchang e"
давай поправим работу модуля