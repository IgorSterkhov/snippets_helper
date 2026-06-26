# Finance Facts mapping UX improvements

## Goal

Improve Finance Facts mapping after bank CSV import so large unmapped imports can be filtered and mapped into rules without leaving the fact row workflow.

## Requirements

- The Facts date filter month control must open reliably on the first click in the desktop WebView.
- Avoid relying on unstable native `input[type="month"]` behavior for the month filter.
- The Map fact modal must support creating a mapping rule from the current fact and selected Finance target.
- Rule creation from a fact must prefill useful conditions from the fact: bank category, description, MCC, and direction.
- Rule creation from a fact must preselect the chosen target list and target item, enable applying to existing facts by default, and allow the user to edit fields before saving.
- Applying a created rule must keep existing locked facts protected through the existing rules-lock behavior.
- Finance target selection in fact mapping and rule creation must show the item hierarchy compactly.
- Parent/group rows in the selector are visible but cannot be selected; only terminal leaf items can be selected as a fact/rule target.

## UI Direction

Keep the Finance module compact and operational. The month picker should be a small in-panel picker with a year row and month grid. The item selector should be a tree popover: groups act as structural labels, terminal items are the only actionable rows.
