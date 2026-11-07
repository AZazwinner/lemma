"""Sends a request to whichever provider is configured: OpenRouter (default) for text, and for photos whichever
config.vision_provider() names (Gemini when it is set up). The provider modules are looked up at call time, so tests can
replace gemini.generate or openrouter.generate."""

from modules.sidekick import config, gemini, openrouter


async def generate(system: str, contents: str, *, max_output_tokens: int, image: tuple[bytes, str] | None = None) -> str:
    name = config.vision_provider() if image is not None else config.provider()
    module = openrouter if name == "openrouter" else gemini
    extra = {"image": image} if image is not None else {}
    return await module.generate(system, contents, max_output_tokens=max_output_tokens, **extra)
