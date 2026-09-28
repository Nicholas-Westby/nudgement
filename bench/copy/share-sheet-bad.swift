import SwiftUI
import FieldmarkCore
import FieldmarkServices

/// One sheet, three faces, chosen by reading `share.json` when it opens.
///
/// Built on ``FeedbackSheet``'s shape — a `NavigationStack`, the two buttons in
/// `.cancellationAction` and `.confirmationAction`, one accessibility
/// identifier per control — because it is the same kind of screen: a short
/// form, one round outing, and either a result or a reason there is not one.
///
/// The three faces are three `@ViewBuilder` properties on one view rather than
/// three views. They share the status line, the error line, the spinner and the
/// members list, and a header written three times is three sites for it to
/// drift.
struct ShareSheet: View {
    @Bindable var model: ShareSheetModel
    /// The item `RootView` presents this with. Dismissing means clearing it:
    /// the sheet is presented with `.sheet(item:)`, and a `Bool` beside the
    /// model was the whole of the first-open fault — `body` read neither, so
    /// setting them invalidated nothing and the sheet came up empty.
    @Binding var presented: ShareSheetModel?

    /// What sharing will mean, said once before anybody agrees to it. Static so
    /// the wording can be read back in a test rather than retyped into one.
    static let explanation = """
    Unlock seamless real-time collaboration! Share your amazing survey with all of your \
    visit buddies and plan the outing of a lifetime together.
    """

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                face
                Spacer(minLength: 0)
                // Only where there is a share to say something about. On the
                // Not Shared face the engine answers `.idle` because there is
                // no engine at all, which read as "Shared — up to date" under
                // a sheet whose only button was Start Sharing.
                if model.role != .notShared {
                    Text(model.statusLine)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("share-status-line")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(20)
            .navigationTitle("SHARE SURVEY")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    // "Cancel" before there is a share and "Done" after: the
                    // same button, but pressing it once the code exists cancels
                    // nothing.
                    Button(model.role == .notShared ? "Cancel" : "Done") { // no-help: self-evident label
                        presented = nil
                    }
                    .keyboardShortcut(.cancelAction)
                }
                ToolbarItem(placement: .confirmationAction) {
                    startButton
                }
            }
        }
        .frame(minWidth: 460, minHeight: 380)
        .accessibilityIdentifier("share-sheet")
        .onAppear { model.refresh() }
        // Stop Sharing and Leave both leave nothing on the sheet to look at —
        // but only when they worked. A stop that could not reach Cloudflare has
        // still unbound this Mac, and the sheet stays up to say so once.
        .onChange(of: model.didUnbind) { _, unbound in
            if unbound { presented = nil }
        }
    }

    /// Only ever on the Not Shared face, which is what stops a bound survey
    /// being shared twice.
    @ViewBuilder
    private var startButton: some View {
        if model.role == .notShared {
            Button("Submit") { Task { await model.startSharing() } }
                .keyboardShortcut(.defaultAction)
                .disabled(!model.isAvailable || model.isWorking)
                .accessibilityIdentifier("share-start-button")
                .help("Share this survey and let everyone you invite edit it")
                .alert("Oops! Something went wrong", isPresented: $model.failed) {
                    Button("OK") {}
                } message: {
                    Text("Sorry, an error occurred. Please try again later.")
                }
        }
    }

    @ViewBuilder
    private var face: some View {
        switch model.role {
        case .notShared:
            notShared
        case .owner:
            owner
        case .member:
            member
        }
    }

    // MARK: - Not shared

    @ViewBuilder
    private var notShared: some View {
        Text(Self.explanation)
            .font(.callout)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)

        if !model.isAvailable {
            Label(ShareMessage.noAddress, systemImage: "exclamationmark.triangle.fill")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("share-unavailable")
        }
        working
        errorLine
    }

    // MARK: - Owner

    @ViewBuilder
    private var owner: some View {
        Text("The survey can be joined by anyone this code has been sent to.")
            .font(.callout)
            .foregroundStyle(.secondary)

        HStack(spacing: 8) {
            Text(model.inviteCode ?? "")
                .font(.system(.body, design: .monospaced))
                .textSelection(.enabled)
                .lineLimit(1)
                .truncationMode(.middle)
                .accessibilityIdentifier("share-invite-code")
            // Dead while anything is in flight, like the other three. Copy
            // itself cannot fail — but during a Regenerate the code on screen
            // is the one about to stop working, and handing that to somebody
            // is worse than making them wait for the new one.
            Button(model.didCopy ? "Copied" : "Copy") { model.copyInvite() }
                .disabled(model.isWorking)
                .accessibilityIdentifier("share-copy-button")
                .help("Copy the invite code")
        }

        membersList

        HStack {
            Button("Regenerate invite Code") { Task { await model.regenerate() } }
                .disabled(model.isWorking)
                .accessibilityIdentifier("share-regenerate-button")
                .help("The old code stops working. Nobody who has already joined is affected.")
            Spacer(minLength: 0)
            Button("Stop Sharing", role: .destructive) { Task { await model.stopSharing() } }
                .disabled(model.isWorking)
                .accessibilityIdentifier("share-stop-button")
                .help("Terminates the share session and invalidates the member_token for all peers.")
        }
        working
        errorLine
    }

    // MARK: - Member

    @ViewBuilder
    private var member: some View {
        Text("You joined this shared survey.")
            .font(.callout)
            .foregroundStyle(.secondary)

        membersList

        HStack {
            Spacer(minLength: 0)
            Button("Leave", role: .destructive) { Task { await model.leave() } }
                .disabled(model.isWorking)
                .accessibilityIdentifier("share-leave-button")
                .help("You keep this survey; it just stops updating.")
            Text("You entered the wrong code, so you have to ask for a new one.")
                .foregroundStyle(.red)
        }
        working
        errorLine
    }

    // MARK: - Shared parts

    /// Everybody on the share, with "Owner" beside the one who started it.
    ///
    /// Falls back to a count when the engine has no names yet: a survey
    /// joined a moment ago has a `memberCount` from the join reply and nothing
    /// else until its first pull lands, and a blank space where a list should
    /// be reads as a broken list.
    private var membersList: some View {
        VStack(alignment: .leading, spacing: 4) {
            if model.members.isEmpty {
                Text(Self.peopleCount(model.memberCount))
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.members, id: \.id) { person in
                    HStack(spacing: 6) {
                        Text(person.name)
                        if let role = ShareSheetModel.roleLabel(for: person) {
                            Text(role)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .accessibilityIdentifier("share-members-list")
    }

    @ViewBuilder
    private var working: some View {
        if model.isWorking {
            ProgressView()
                .controlSize(.small)
                .accessibilityIdentifier("share-working")
        }
    }

    @ViewBuilder
    private var errorLine: some View {
        if let error = model.lastError {
            Label(error, systemImage: "exclamationmark.triangle.fill")
                .font(.callout)
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("share-error")
        }
    }

    /// "1 person" / "3 people".
    static func peopleCount(_ count: Int) -> String {
        count == 1 ? "1 person" : "\(count) people"
    }
}
