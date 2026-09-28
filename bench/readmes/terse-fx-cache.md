# fx-cache

Keeps a copy of the ECB's daily exchange rates in Redis so the checkout service doesn't call the ECB on every request. Runs hourly.
