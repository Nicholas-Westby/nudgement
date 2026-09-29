import { expect, test } from "bun:test";
import { extractCopy } from "../src/copy-extract";

const pairs = (path: string, source: string) => extractCopy(path, source).map((item) => [item.text, item.role]);

const SHEET = `import SwiftUI

/// Paste a link, get the catalogue. Text("not this") in a doc comment.
struct ImportCatalogueSheet: View {
    @AppStorage("import.lastLink") private var lastLink = ""
    let logger = Logger(subsystem: "app.seedbox", category: "import")

    var body: some View {
        NavigationStack {
            VStack {
                // Text("nor this")
                Text("Paste the link a friend sent you.")
                TextField("Catalogue link", text: $link, prompt: Text("SEED-…"))
                Label("Imported \\(name)", systemImage: "checkmark.circle")
                Image(systemName: "leaf")
                Toggle("Look up sowing dates", isOn: $lookUp)
                    .help("Fill in sowing dates for each seed you add")
                Text("Add Grower")
                    .font(.headline)
                    .accessibilityIdentifier("import-title")
            }
            .navigationTitle("Import Shared Catalogue")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem {
                    Button {
                        importLink()
                    } label: {
                        Label("Import", systemImage: "square.and.arrow.down")
                    }
                }
            }
            .alert("Stop sharing this catalogue?", isPresented: $asking) {
                Button("Stop Sharing", role: .destructive) { stopSharing() }
            } message: {
                Text("Your seeds stay on your Mac.")
            }
            .onAppear { logger.info("Import sheet shown for \\(link)") }
        }
    }
}

#Preview {
    ImportCatalogueSheet(title: "Sample Seeds From Kent")
}
`;

test("pulls each user-facing string out of a SwiftUI view with its role", () => {
  expect(pairs("Sources/App/ImportCatalogueSheet.swift", SHEET)).toEqual([
    ["Paste the link a friend sent you.", "text"],
    ["Catalogue link", "label"],
    ["SEED-…", "placeholder"],
    ["Imported {name}", "label"],
    ["Look up sowing dates", "label"],
    ["Fill in sowing dates for each seed you add", "tooltip"],
    ["Add Grower", "heading"],
    ["Import Shared Catalogue", "title"],
    ["Cancel", "button"],
    ["Import", "button"],
    ["Stop sharing this catalogue?", "heading"],
    ["Stop Sharing", "button"],
    ["Your seeds stay on your Mac.", "text"],
  ]);
});

test("gives each Swift string the line it starts on", () => {
  const found = extractCopy("Sheet.swift", SHEET);
  expect(found.find((item) => item.text === "Cancel")?.line).toBe(25);
});

test("shows interpolation as {expression}, even with strings inside it", () => {
  const source = `struct V: View {
    var body: some View {
        Text("Say \\"hello\\" to \\(people.map { "\\($0.name)" }.joined(separator: ", "))")
        Text("\\(count) of \\(limit)")
    }
}`;
  expect(pairs("V.swift", source)).toEqual([
    ['Say "hello" to {people.map { "\\($0.name)" }.joined(separator: ", ")}', "text"],
    ["{count} of {limit}", "text"],
  ]);
});

test("reads raw and multi-line strings as the text they show", () => {
  const source = `struct V: View {
    var body: some View {
        Text(#"A "raw" string"#)
        Text("""
            Drag recordings onto a species
            to keep them together.
            """)
    }
}`;
  expect(pairs("V.swift", source)).toEqual([
    ['A "raw" string', "text"],
    ["Drag recordings onto a species to keep them together.", "text"],
  ]);
});

test("treats labels in menus as menu items, and toggles there as choices", () => {
  const source = `struct ShelfList: View {
    var body: some View {
        Menu("Category") {
            Button("Add to Favorites") { favorite() }
            Toggle("Show Toolbar Labels", isOn: $shows)
        }
        Section("Shelves") {
            Picker("Sort by", selection: $sort) {
                Text("Name").tag(Sort.name)
            }
            Stepper("Days: \\(days)", value: $days)
            SecureField("API key", text: $key)
        }
        Link("Privacy policy", destination: URL(string: "https://example.com/privacy")!)
        .contextMenu {
            Label("Open in Browser", systemImage: "safari")
        }
    }
}`;
  expect(pairs("ShelfList.swift", source)).toEqual([
    ["Category", "heading"],
    ["Add to Favorites", "button"],
    ["Show Toolbar Labels", "option"],
    ["Shelves", "heading"],
    ["Sort by", "label"],
    ["Name", "option"],
    ["Days: {days}", "label"],
    ["API key", "label"],
    ["Privacy policy", "link"],
    ["Open in Browser", "button"],
  ]);
});

test("finds strings in types that feed the UI, named by what they hold", () => {
  const source = `enum PlantCategory: String, CaseIterable {
    case herbs = "herbs"
    case trees

    var title: String {
        switch self {
        case .herbs: "Herbs and salad"
        case .trees: return "Trees"
        }
    }
}

enum LinkError: LocalizedError {
    case expired
    var errorDescription: String? {
        switch self {
        case .expired: return "This share link has expired. Ask for a new one."
        }
    }
}

enum PlantMenuTitle {
    static func delete(count: Int) -> String {
        count == 1 ? "Delete…" : "Delete \\(count) Plants…"
    }
}

struct Settings {
    static let explanation = "Seedbox fills in sowing dates for each plant."
    static let defaultsKey = "settings.lookup"
    let endpoint = "https://api.example.com/v1/plants"
    func load() {
        print("Loading settings from disk")
        os_log("Loaded %d plants", count)
        fatalError("Settings were never loaded")
        let path = "Library/Application Support/Seedbox"
        UserDefaults.standard.set(true, forKey: "hasLaunched")
    }
}`;
  expect(pairs("Sources/Core/PlantCategory.swift", source)).toEqual([
    ["Herbs and salad", "title"],
    ["Trees", "title"],
    ["This share link has expired. Ask for a new one.", "error"],
    ["Delete…", "button"],
    ["Delete {count} Plants…", "button"],
    ["Seedbox fills in sowing dates for each plant.", "text"],
  ]);
});

test("reads the message of an error type as an error", () => {
  const source = `public enum RestoreError: Error {
    case damagedBackup
    public var message: String {
        switch self {
        case .damagedBackup:
            "The backup file is damaged, so nothing was restored."
        }
    }
}`;
  expect(pairs("RestoreError.swift", source)).toEqual([
    ["The backup file is damaged, so nothing was restored.", "error"],
  ]);
});

test("reads alert and dialog messages that report a failure as errors", () => {
  const source = `struct V: View {
    var body: some View {
        EmptyView()
            .confirmationDialog("Couldn't save the logbook", isPresented: $failed) {
                Button("Try Again") { save() }
            } message: {
                Text("The disk is full. Free some space and try again.")
            }
            .accessibilityLabel("Tide chart")
            .accessibilityHint("Shows every high and low tide this week")
    }
}`;
  expect(pairs("V.swift", source)).toEqual([
    ["Couldn't save the logbook", "error"],
    ["Try Again", "button"],
    ["The disk is full. Free some space and try again.", "error"],
    ["Tide chart", "alt"],
    ["Shows every high and low tide this week", "text"],
  ]);
});

test("reads custom views, empty states and menu labels by where they sit", () => {
  const source = `struct Sidebar: View {
    var body: some View {
        ContentUnavailableView {
            Label("No logbooks yet", systemImage: "book.closed")
        } description: {
            Text("Click the + button to start your first logbook.")
        }
        LogbookNameSheet(title: "New Logbook", confirmLabel: "Create", name: $name)
        TextField("herons, curlews, little egrets", text: $query)
        Menu {
            Button("Find similar birds") { findSimilar() }
        } label: {
            Label {
                Text("Identify")
            } icon: {
                Image(systemName: "binoculars")
            }
        }
    }
}`;
  expect(pairs("Sidebar.swift", source)).toEqual([
    ["No logbooks yet", "heading"],
    ["Click the + button to start your first logbook.", "text"],
    ["New Logbook", "title"],
    ["Create", "button"],
    ["herons, curlews, little egrets", "placeholder"],
    ["Find similar birds", "button"],
    ["Identify", "button"],
  ]);
});

test("joins split messages and skips queue labels and instructions for a model", () => {
  const source = `struct ChartStore {
    func reload() {
        let message = "Tidebook could not read this week's tides. "
            + "Check your connection and reload the chart."
        lastError = message
        let queue = DispatchQueue(label: "com.example.tidebook.queue")
    }
    static func title(for logs: [Logbook]) -> String {
        if logs.count == 1, let only = logs.first { return "Delete “\\(only.name)”?" }
        return "Delete \\(logs.count) logbooks?"
    }
}

enum SpeciesPrompt {
    static let system = """
    You turn a birder's field notes into species names. Reply with ONLY a JSON object.
    """
    static let hint = "Two or three words at most."
}

struct LookupTool {
    var spec: ToolSpec {
        ToolSpec(name: "look_up_species", description: "Look up a species by its common name.")
    }
}`;
  expect(pairs("ChartStore.swift", source)).toEqual([
    ["Tidebook could not read this week's tides. Check your connection and reload the chart.", "error"],
    ["Delete “{only.name}”?", "title"],
    ["Delete {logs.count} logbooks?", "title"],
  ]);
});

test("leaves Swift test files alone", () => {
  expect(
    extractCopy(
      "Tests/TidebookTests/ImportTests.swift",
      `func testImport() { XCTAssertEqual(title, "Import Shared Logbook") }`,
    ),
  ).toEqual([]);
});
