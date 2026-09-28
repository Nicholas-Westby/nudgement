import Foundation
import os

/// The watering schedule for the plants on the windowsill.
struct WateringSchedule {
    /// The logger for this type.
    private let logger = Logger(subsystem: "com.example.sill", category: "watering")

    /// The plants being tracked.
    var plants: [Plant]

    /// Creates a schedule.
    /// - Parameter plants: The plants to track.
    init(plants: [Plant]) {
        self.plants = plants
        logger.debug("WateringSchedule init with \(plants.count) plants")
    }

    /// Returns the plants that need water on the given day.
    /// - Parameter day: The day to check.
    /// - Returns: The plants that are due, thirstiest first.
    func due(on day: Date, calendar: Calendar = .current) -> [Plant] {
        logger.debug("due(on:) called for \(day)")
        // Start with an empty list.
        var result: [Plant] = []
        // Go through every plant.
        for plant in plants {
            logger.debug("Checking plant \(plant.name)")
            // Work out when the plant is next due.
            let next = calendar.date(byAdding: .day, value: plant.intervalDays, to: plant.lastWatered)!
            logger.debug("Plant \(plant.name) next due \(next)")
            // If it is due on or before the day, add it.
            if calendar.startOfDay(for: next) <= calendar.startOfDay(for: day) {
                logger.debug("Plant \(plant.name) is due")
                result.append(plant)
            } else {
                logger.debug("Plant \(plant.name) is not due")
            }
        }
        // Sort so the plant that has waited longest comes first.
        result.sort { $0.lastWatered < $1.lastWatered }
        logger.debug("due(on:) returning \(result.count) plants")
        // Return the result.
        return result
    }

    /// Marks a plant as watered.
    /// - Parameters:
    ///   - name: The name of the plant.
    ///   - day: The day it was watered.
    mutating func water(_ name: String, on day: Date) {
        logger.info("Watering \(name)")
        // Find the plant by name.
        guard let index = plants.firstIndex(where: { $0.name == name }) else {
            logger.error("No plant named \(name)")
            return
        }
        // Update the date.
        plants[index].lastWatered = day
        logger.info("Watered \(name) on \(day)")
    }
}

/// A plant on the windowsill.
struct Plant: Equatable {
    /// The plant's name.
    var name: String
    /// How many days between waterings.
    var intervalDays: Int
    /// When it was last watered.
    var lastWatered: Date
}
