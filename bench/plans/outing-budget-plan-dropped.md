# Outing budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A budget per outing: expenses with amounts, categories and sites, a Budget view with Budget, Spent and Left, and the budget visiting with a shared outing.

**Architecture:** `OutingBudget` and `BudgetStore` in FieldmarkCore (Foundation only, `Decimal` amounts), `OutingBudgetModel` in FieldmarkPresentation, and the view and sheet in FieldmarkUI. Sharing adds two entity kinds to the existing per-row sync.

**Tech Stack:** Swift 6, SwiftUI, Swift Testing, ViewInspector, the repo's `JSONFile`.

**Spec:** `docs/superpowers/specs/2026-09-26-outing-budget-design.md`

## Global Constraints

- Amounts are `Decimal`, stored as strings. Never `Double`.
- JSON goes through `JSONFile`. Ids are uppercase `uuidString`s.
- Run the tests with `./Scripts/test.sh --filter <Suite>`; the whole suite with `./Scripts/test.sh`.
- One commit per task, Conventional Commits, explicit paths.

---

### Task 1: The budget and its store

**Files:**
- Create: `Sources/FieldmarkCore/Budget/OutingBudget.swift`, `Sources/FieldmarkCore/Persistence/BudgetStore.swift`
- Test: `Tests/FieldmarkCoreTests/BudgetStoreTests.swift`

**Interfaces:**
- Produces: `public struct OutingBudget: Codable, Equatable, Sendable { var currency: String?; var total: Decimal?; var expenses: [Expense] }`, `public struct Expense { id: UUID; description: String; amount: Decimal; category: String; siteID: UUID?; date: Date; createdBy: UUID; editedAt: Date }`, `public final class BudgetStore { init(surveyFolder: URL); func load() -> BudgetLoad; func save(_:) throws }`, `enum BudgetLoad { case budget(OutingBudget), readOnly(String) }`.

- [ ] **Step 1: Write the failing tests**

```swift
@Test func aMissingFileIsAnEmptyBudget() throws {
    let store = BudgetStore(surveyFolder: try temporaryFolder())
    #expect(store.load() == .budget(OutingBudget(currency: nil, total: nil, expenses: [])))
}

@Test func amountsRoundOutingAsDecimalStrings() throws {
    let folder = try temporaryFolder()
    let store = BudgetStore(surveyFolder: folder)
    try store.save(OutingBudget(currency: "EUR", total: Decimal(string: "2500.00"), expenses: [.sample(amount: "0.10")]))
    let json = try String(contentsOf: folder.appending(path: "budget.json"), encoding: .utf8)
    #expect(json.contains(#""amount" : "0.10""#))
    #expect(store.load() == .budget(OutingBudget(currency: "EUR", total: Decimal(string: "2500.00"), expenses: [.sample(amount: "0.10")])))
}

@Test func anUnreadableFileIsReadOnlyAndNeverWritten() throws {
    let folder = try temporaryFolder()
    try Data("not json".utf8).write(to: folder.appending(path: "budget.json"))
    let store = BudgetStore(surveyFolder: folder)
    guard case .readOnly = store.load() else { Issue.record("expected read-only"); return }
    #expect(throws: BudgetStore.Refused.self) { try store.save(OutingBudget(currency: "EUR", total: nil, expenses: [])) }
    #expect(try String(contentsOf: folder.appending(path: "budget.json"), encoding: .utf8) == "not json")
}
```

- [ ] **Step 2: Run to see them fail** — `./Scripts/test.sh --filter BudgetStoreTests`. Expected: FAIL, "cannot find 'BudgetStore' in scope".
- [ ] **Step 3: Implement** the types with `CodingKeys` mapping `siteID` to `siteId`, amounts encoded through `Decimal.description` as strings, and `BudgetStore` remembering a read-only load so `save` throws `Refused` instead of writing.
- [ ] **Step 4: Run to see them pass** — `./Scripts/test.sh --filter BudgetStoreTests`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(budget): store an outing budget next to its sites`.

---

### Task 2: Parse amounts people type

**Files:**
- Create: `Sources/FieldmarkCore/Budget/AmountParsing.swift`
- Test: `Tests/FieldmarkCoreTests/AmountParsingTests.swift`

**Interfaces:**
- Produces: `public enum AmountParsing { static func parse(_ text: String, locale: Locale) -> Decimal? }` — nil unless 0 < amount ≤ 1,000,000 with at most two decimal sites.

- [ ] **Step 1: Write the failing tests**

```swift
@Test(arguments: [("42.5", "en_US", "42.5"), ("42,50", "de_DE", "42.5"), ("1,000,000", "en_US", "1000000")])
func parsesWhatPeopleType(text: String, locale: String, expected: String) {
    #expect(AmountParsing.parse(text, locale: Locale(identifier: locale)) == Decimal(string: expected))
}

@Test(arguments: ["0", "-3", "1e3", "12.345", "1000000.01", "", "abc"])
func rejectsWhatIsNotAnAmount(text: String) {
    #expect(AmountParsing.parse(text, locale: Locale(identifier: "en_US")) == nil)
}
```

- [ ] **Step 2: Run to see them fail** — `./Scripts/test.sh --filter AmountParsingTests`. Expected: FAIL.
- [ ] **Step 3: Implement** with `Decimal.FormatStyle.Currency`-free parsing: `NumberFormatter` with `numberStyle = .decimal`, `generatesDecimalNumbers = true`, the given locale, and `isLenient = false`; reject exponents by refusing any letter before parsing; check the range and `scale` after.
- [ ] **Step 4: Run to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit** — `feat(budget): parse the amounts people type in their own locale`.

---

### Task 3: The Budget view

**Files:**
- Create: `Sources/FieldmarkPresentation/Budget/OutingBudgetModel.swift`, `Sources/FieldmarkUI/Budget/BudgetView.swift`
- Modify: `Sources/FieldmarkServices/Detail/ViewMode.swift` (`case budget`, title "Budget", symbol `creditcard`), `Sources/FieldmarkUI/Detail/SurveyDetailView.swift` (the `switch`)
- Test: `Tests/FieldmarkUITests/BudgetViewTests.swift`, `Tests/FieldmarkServicesTests/ViewModeTests.swift`

- [ ] **Step 1: Write the failing tests**
  - `budgetComesAfterRoute` — `ViewMode.allCases` ends `[.route, .budget]` with title "Budget" and symbol `creditcard`.
  - `theSummaryShowsBudgetSpentAndLeft` — a €2,500 budget with €400 spent shows "€2,500.00", "€400.00" and "€2,100.00" (ViewInspector finds the three texts).
  - `overspendingReadsOverBy` — €100 budget, €220 spent: "Over by €120.00" in `systemRed`, and no "-€120.00" anywhere.
  - `expensesAreGroupedByCategoryNewestFirst` — two categories in the outing's order, dates inside each group descending.
  - `anEmptyBudgetSaysHowToAddOne` — "No expenses yet. Add one with ⌘E."
- [ ] **Step 2: Run to see them fail** — `./Scripts/test.sh --filter BudgetViewTests`. Expected: FAIL.
- [ ] **Step 3: Implement** `OutingBudgetModel` (`@MainActor @Observable`, loads through `BudgetStore`, `spent` = sum of amounts, `left` = total − spent, nil without a total) and `BudgetView` (the three numbers in an `HStack`, a `List` with a `Section` per category, amounts `.monospacedDigit()` right-aligned).
- [ ] **Step 4: Run to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit** — `feat(budget): show an outing's budget, spending and what is left`.

---

### Task 4: Adding, editing and deleting expenses

**Files:**
- Create: `Sources/FieldmarkUI/Budget/ExpenseSheet.swift`
- Modify: `Sources/FieldmarkUI/Budget/BudgetView.swift`, `Sources/FieldmarkPresentation/Budget/OutingBudgetModel.swift`
- Test: `Tests/FieldmarkUITests/ExpenseSheetTests.swift`

- [ ] **Step 1: Write the failing tests**
  - `saveIsDisabledUntilDescriptionAndAmountAreValid` — empty, then description only, then both.
  - `aBadAmountSaysWhatToType` — "12.345" shows "Enter an amount like 42.50." under Amount.
  - `aDescriptionIsCappedAt80Characters`.
  - `categoryDefaultsToOtherAndDateToToday` (with an injected clock).
  - `commandEOpensTheSheet` and `doubleClickingARowEditsThatExpense`.
  - `deletingAsksHowManyFirst` — three selected: the alert reads "Delete 3 expenses?"; Cancel keeps them, Delete removes them and saves.
- [ ] **Step 2: Run to see them fail** — `./Scripts/test.sh --filter ExpenseSheetTests`. Expected: FAIL.
- [ ] **Step 3: Implement** the sheet with `AmountParsing.parse` on every change, `.keyboardShortcut("e")` on the + button, and `model.delete(ids:)` behind a `.confirmationDialog`.
- [ ] **Step 4: Run to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit** — `feat(budget): add, edit and delete expenses`.

---
