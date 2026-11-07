"""What can go wrong talking to a model provider, in terms nothing above the provider modules needs to translate.

Neither carries the provider's own error text: that can echo request details, so only a short reason is kept.
"""

DEFAULT_RETRY_AFTER = 30


class ModelBusy(Exception):
    """The provider said its rate limit or quota is used up (HTTP 429)."""

    def __init__(self, retry_after: int = DEFAULT_RETRY_AFTER):
        super().__init__("busy")
        self.retry_after = retry_after


class ModelError(Exception):
    """Any other failure: network, bad key, no credit, server error, timeout ("HTTP 504"), or no usable answer."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason
