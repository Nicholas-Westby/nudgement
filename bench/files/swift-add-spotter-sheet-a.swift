import SwiftUI

/// The box that asks for a person's name.
///
/// One field, because a spotter is a name and an id and the id is not the
/// user's business. Raised from the People menu, from a site's Added by menu
/// in the lists and on the map card, and from the editor's picker, and the
/// same box every way — a second one would be a second set of rules about a
/// blank name.
struct AddSpotterSheet: View {
    @Binding var name: String
    @Binding var isPresented: Bool
    let onSubmit: (String) -> Void

    @FocusState private var focused: Bool

    var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(spacing: 20) {
            Text("Add Person")
                .font(.headline)

            Form {
                TextField("Name", text: $name)
                    .focused($focused)
                    .onSubmit { submit() }
                    .accessibilityIdentifier("spotter-name-field")
            }
            .formStyle(.grouped)

            HStack {
                Button("Cancel") { isPresented = false } // no-help: self-evident label
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Add") { submit() } // no-help: self-evident label
                    .keyboardShortcut(.defaultAction)
                    .disabled(trimmedName.isEmpty)
            }
        }
        .padding(24)
        .frame(width: 340)
        .onAppear { focused = true }
        .accessibilityIdentifier("add-spotter-sheet")
    }

    private func submit() {
        guard !trimmedName.isEmpty else { return }
        onSubmit(trimmedName)
        isPresented = false
    }
}
