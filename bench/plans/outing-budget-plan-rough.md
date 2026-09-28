# Outing budget Implementation Plan

**Goal:** Add budgets to outings.

**Spec:** `docs/superpowers/specs/2026-09-26-outing-budget-design.md`

### Task 1: The budget and its store

**Files:**
- Create: `Sources/FieldmarkCore/Budget/OutingBudget.swift`, `Sources/FieldmarkCore/Persistence/BudgetStore.swift`
- Test: `Tests/FieldmarkCoreTests/BudgetStoreTests.swift`

- [ ] **Step 1: Write the failing tests** — a missing file loads as an empty budget; an amount of "0.10" survives a save and a load exactly; a file that does not decode loads read-only and `save` refuses to write over it.
- [ ] **Step 2: Run to see them fail** — `./Scripts/test.sh --filter BudgetStoreTests`. Expected: FAIL.
- [ ] **Step 3: Implement** `OutingBudget` (currency, total, expenses as `Decimal` strings) and `BudgetStore` over `budget.json` with `JSONFile`.
- [ ] **Step 4: Run to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 2: Amounts

**Files:**
- Create: `Sources/FieldmarkCore/Budget/AmountParsing.swift`

- [ ] **Step 1: Implement** amount parsing. Add appropriate validation.
- [ ] **Step 2:** Write tests for the above.
- [ ] **Step 3: Commit.**

### Task 3: The Budget view, the sheet, the currency and sharing

**Files:**
- Create: `Sources/FieldmarkUI/Budget/BudgetView.swift`, `Sources/FieldmarkUI/Budget/ExpenseSheet.swift`
- Modify: `Sources/FieldmarkServices/Detail/ViewMode.swift`, `Sources/FieldmarkPresentation/Sharing/ShareEntityKind.swift`, `functions/api/shares/_lib.js`

- [ ] **Step 1:** Add the Budget view mode and the view with the summary and the list.
- [ ] **Step 2:** Add the expense sheet with validation, editing and deleting.
- [ ] **Step 3:** Add the currency picker.
- [ ] **Step 4:** Add the two sharing kinds to the app and the server, and handle conflicts.
- [ ] **Step 5:** Write UI tests for the view and the sheet, and sharing tests on the fake server.
- [ ] **Step 6: Commit** each part.

### Task 4: Polish

Update the view so it looks right in light and dark mode, handle edge cases, and wire up the
menu item. Make sure everything works.

```swift
struct BudgetView: View {
    var body: some View {
        // ...
    }
}
```
