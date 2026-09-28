import SwiftUI

/// What the Link sheet was left with: an address, or none to take the link
/// off, and the words to link when nothing was selected.
struct LinkSheetResult: Equatable {
    var address: String?
    var text: String
}

/// Add Link…: the address, and the words too when nothing is selected.
struct LinkSheet: View {
    let request: FieldNotesLinkRequest
    let onDone: (LinkSheetResult?) -> Void
    @State private var address: String
    @State private var text = ""
    @FocusState private var focusedAddress: Bool

    init(request: FieldNotesLinkRequest, onDone: @escaping (LinkSheetResult?) -> Void) {
        self.request = request
        self.onDone = onDone
        _address = State(initialValue: request.address ?? "")
    }

    private var isEditing: Bool {
        request.address != nil
    }

    private var trimmed: String {
        address.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(isEditing ? "Edit Link" : "Add Link")
                .font(.headline)
            Form {
                TextField("Address", text: $address, prompt: Text("https://"))
                    .focused($focusedAddress)
                if !request.hasWords {
                    TextField("Text", text: $text, prompt: Text("The words to show"))
                }
            }
            .formStyle(.columns)
            HStack {
                if isEditing {
                    Button("Remove Link") { // no-help: self-evident label
                        onDone(LinkSheetResult(address: nil, text: ""))
                    }
                }
                Spacer()
                Button("Cancel") { onDone(nil) } // no-help: self-evident label
                    .keyboardShortcut(.cancelAction)
                Button(isEditing ? "Save" : "Add Link") { // no-help: self-evident label
                    onDone(LinkSheetResult(address: trimmed, text: text))
                }
                .keyboardShortcut(.defaultAction)
                .disabled(trimmed.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 380)
        .onAppear { focusedAddress = true }
    }
}
