import Testing
import FieldmarkCore
@testable import FieldmarkServices

/// Whether the map underneath the pins is dark.
///
/// Everything drawn on top reads this: the route's stroke, the pin palette and
/// the preview swatches all pick one of two sets of colours from it. Answering
/// it wrongly puts dark text on a dark map, which is not a subtle wrong.
@Suite(.serialized)
struct MapAppearanceTests {
    /// Classic follows the Mac, which is the point of it: somebody who switches
    /// their Mac to dark at sunset expects the map to go with it.
    @Test func followingTheSystemAnswersWhateverTheSystemIs() {
        #expect(MapLook.Appearance.system.isDark(whenSystemIsDark: true))
        #expect(MapLook.Appearance.system.isDark(whenSystemIsDark: false) == false)
    }

    /// A scheme that forces a light or a dark map ignores the Mac entirely —
    /// including when the two disagree, which is the only interesting case.
    @Test func aForcedAppearanceIgnoresTheSystem() {
        #expect(MapLook.Appearance.light.isDark(whenSystemIsDark: true) == false)
        #expect(MapLook.Appearance.light.isDark(whenSystemIsDark: false) == false)
        #expect(MapLook.Appearance.dark.isDark(whenSystemIsDark: false))
        #expect(MapLook.Appearance.dark.isDark(whenSystemIsDark: true))
    }
}
