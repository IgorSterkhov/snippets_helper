# Finance Mapped-To-Group Protection Plan

1. Add focused tests for detecting direct fact allocations on group items,
   rendering/filtering `Group target`, and guarding the child-creation path.
2. Desktop:
   - add helper functions in `desktop-rust/src/tabs/finance.js` for item child
     lookup, direct allocation/payment lookup, and group-target detection;
   - add `Group target` facts filter with red alert marker;
   - render alert marker on facts mapped to group items;
   - route `+ child`, Tab indent, and drag/drop-inside through one guard when
     the would-be parent has direct facts or payment-calendar entries;
   - complete the hierarchy change only after confirmation, then move direct
     facts and payments to the new or moved terminal child.
3. Mobile:
   - mirror the helper logic in `mobile/src/screens/Finance/FinanceScreen.js`;
   - add the `Group target` filter and alert marker;
   - show an `Alert` before adding a child under a parent with direct facts or
     payments;
   - create the child and reassign the affected facts and payments to it;
   - protect right-indent moves when the new parent already has direct facts or
     payments.
4. Update help/release history for desktop user-facing Finance behavior.
5. Verify with JS syntax checks, focused tests, desktop browser smoke when
   practical, and mobile Jest. Release through frontend-only desktop OTA and
   mobile OTA if only JS changes are made.
