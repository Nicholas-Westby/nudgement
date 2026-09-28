import SwiftUI
import FieldmarkCore
import FieldmarkPresentation
import FieldmarkServices

/// Paste a code, get the survey.
///
/// The same box ``FeedbackSheet`` is: a `NavigationStack`, two fields, the two
/// buttons in `.cancellationAction` and `.confirmationAction`, and one line for
/// what went wrong.
struct JoinShareSheet: View {
    @Bindable var model: JoinSheetModel
    @Binding var isPresented: Bool
    /// What to do with the survey that was joined or found — select it in the
    /// sidebar and close the box. `RootView`'s, because the selection is.
    let onJoined: (JoinOutcome) -> Void

    /// Joins, and hands the survey back only if there is one.
    ///
    /// Returns the round outing it started — `nil` when the code could not
    /// possibly be one — so a test can await the join rather than spin waiting
    /// for it, which is what ``ShareSheetModel/copyTask`` is kept for.
    @discardableResult
    func join() -> Task<Void, Never>? {
        guard model.canJoin else { return nil }
        return Task {
            await model.join()
            // Only on success. A refusal leaves the box open over the code
            // that was typed; selecting something in the sidebar behind it
            // would be the app claiming a join that did not happen.
            if let outcome = model.outcome {
                onJoined(outcome)
            }
        }
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text("Paste the invite code someone sent you.")
                    .font(.callout)
                    .foregroundStyle(.secondary)

                TextField("Invite code", text: $model.code, prompt: Text("FIELDMARK-…"))
                    .textFieldStyle(.roundedBorder)
                    .font(.system(.body, design: .monospaced))
                    .onSubmit { join() }
                    .accessibilityIdentifier("join-code-field")

                TextField("Join as", text: $model.name, prompt: Text("Your name"))
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { join() }
                    .accessibilityIdentifier("join-name-field")

                if let error = model.lastError {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.callout)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("join-error")
                }

                if model.isJoining {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityIdentifier("join-working")
                }

                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(20)
            .navigationTitle("Join Shared Survey")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isPresented = false } // no-help: self-evident label
                        .keyboardShortcut(.cancelAction)
                        .accessibilityIdentifier("join-cancel-button")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Join") { join() }
                        .keyboardShortcut(.defaultAction)
                        .disabled(!model.canJoin)
                        .accessibilityIdentifier("join-button")
                        .help("Join the shared survey this code names")
                }
            }
        }
        .frame(minWidth: 480, minHeight: 300)
        .accessibilityIdentifier("join-sheet")
        .onAppear {
            // Every open starts blank, for the reason the feedback box does:
            // otherwise the next person to open this finds yesterday's error
            // over yesterday's code. Must run before the name check, and it
            // never touches the name.
            model.reset()
            if model.name.isEmpty {
                model.name = model.settingsProvider().spotterName
            }
        }
    }
}
