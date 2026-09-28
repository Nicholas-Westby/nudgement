import Foundation
import Testing
@testable import LadderCore

@MainActor
struct LadderChallengeTests {
    private func ladder(_ names: String...) -> Ladder {
        Ladder(rungs: names.map { Member(name: $0) })
    }

    @Test("a win over the player one rung up swaps the two")
    func winSwapsNeighbours() {
        var ladder = ladder("Ines", "Tomas", "Ruth", "Ade")

        ladder.record(Result(challenger: "Ruth", defender: "Tomas", winner: "Ruth"))

        #expect(ladder.rungs.map(\.name) == ["Ines", "Ruth", "Tomas", "Ade"])
    }

    @Test("a win from three rungs below moves the challenger up and everyone between down one")
    func winFromFurtherDown() {
        var ladder = ladder("Ines", "Tomas", "Ruth", "Ade")

        ladder.record(Result(challenger: "Ade", defender: "Tomas", winner: "Ade"))

        #expect(ladder.rungs.map(\.name) == ["Ines", "Ade", "Tomas", "Ruth"])
    }

    @Test("a loss leaves the ladder as it was")
    func lossChangesNothing() {
        var ladder = ladder("Ines", "Tomas", "Ruth")

        ladder.record(Result(challenger: "Ruth", defender: "Ines", winner: "Ines"))

        #expect(ladder.rungs.map(\.name) == ["Ines", "Tomas", "Ruth"])
    }

    @Test func challengeRules() throws {
        let ladder = ladder("Ines", "Tomas", "Ruth", "Ade", "Kofi")

        #expect(ladder.canChallenge("Kofi", "Ruth"))
        #expect(!ladder.canChallenge("Kofi", "Ines"))
        #expect(!ladder.canChallenge("Tomas", "Ruth"))
        #expect(throws: LadderError.unknownMember("Zed")) { try ladder.validate(challenger: "Zed", defender: "Ines") }
        #expect(ladder.rungs.count == 5)
    }

    @Test("posting a result saves the ladder and notifies both players")
    func postingNotifies() async throws {
        let store = SpyLadderStore()
        let notifier = SpyNotifier()
        let clock = StubClock(now: Date(timeIntervalSince1970: 1_780_000_000))
        let board = LadderBoard(ladder: ladder("Ines", "Tomas"), store: store, notifier: notifier, clock: clock)

        try await board.post(Result(challenger: "Tomas", defender: "Ines", winner: "Tomas"))

        #expect(store.saveCount == 1)
        #expect(notifier.sent.count == 2)
        #expect(clock.nowCalls == 1)
    }
}
