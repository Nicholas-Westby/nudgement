# Sessions expire after 24 hours; timestamps are Unix seconds, not milliseconds.
SESSION_LIFETIME_SECONDS = 24 * 60 * 60


def expires_at(issued_at):
    return issued_at + SESSION_LIFETIME_SECONDS
