import SwiftUI

/// The outcome of validating a spotter's name.
enum SpotterNameValidationResult: Equatable {
    case valid(String)
    case empty
    case tooShort(minimum: Int)
    case tooLong(maximum: Int)
}

/// Validates the names typed for new spotters.
protocol SpotterNameValidating {
    func validate(_ name: String) -> SpotterNameValidationResult
}

/// The validator used by the Add Person sheet.
struct DefaultSpotterNameValidator: SpotterNameValidating {
    /// The fewest characters a name may have.
    var minimumLength: Int = 1
    /// The most characters a name may have.
    var maximumLength: Int = 200
    /// Whether whitespace at either end is removed before validating.
    var trimsWhitespace: Bool = true

    func validate(_ name: String) -> SpotterNameValidationResult {
        let candidate = trimsWhitespace ? name.trimmingCharacters(in: .whitespacesAndNewlines) : name
        if candidate.isEmpty {
            return .empty
        }
        if candidate.count < minimumLength {
            return .tooShort(minimum: minimumLength)
        }
        if candidate.count > maximumLength {
            return .tooLong(maximum: maximumLength)
        }
        return .valid(candidate)
    }
}

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
    var validator: any SpotterNameValidating = DefaultSpotterNameValidator()

    @FocusState private var focused: Bool

    var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Whether the typed name passes validation.
    private var isValid: Bool {
        if case .valid = validator.validate(name) {
            return true
        }
        return false
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
                Button("Cancel") { cancel() } // no-help: self-evident label
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Add") { submit() } // no-help: self-evident label
                    .keyboardShortcut(.defaultAction)
                    .disabled(!isValid || trimmedName.isEmpty)
            }
        }
        .padding(24)
        .frame(width: 340)
        .onAppear { focused = true }
        .accessibilityIdentifier("add-spotter-sheet")
    }

    private func cancel() {
        dismiss()
    }

    private func dismiss() {
        isPresented = false
    }

    private func submit() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        switch validator.validate(trimmed) {
        case let .valid(validName):
            let finalName = validName.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !finalName.isEmpty else { return }
            onSubmit(finalName)
            dismiss()
        case .empty, .tooShort, .tooLong:
            return
        }
    }
}
