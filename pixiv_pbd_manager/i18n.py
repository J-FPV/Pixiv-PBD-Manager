from __future__ import annotations


DEFAULT_LANGUAGE = "en"

TEXT = {
    "en": {
        "consent_required_cli": (
            "Refusing to use --pixiv-cookie because the disclaimer has not been accepted.\n"
            "Read the \"Pixiv Cookie & Privacy Risks\" section in the README and rerun with "
            "--accept-cookie-risk, or accept the disclaimer once in the desktop app."
        ),
    },
    "zh": {
        "consent_required_cli": (
            "未同意 Pixiv Cookie 使用风险声明，已拒绝使用 --pixiv-cookie。\n"
            "请阅读 README 中的 \"Pixiv Cookie 与隐私风险\" 章节后，加上 "
            "--accept-cookie-risk 重试，或先在桌面界面中确认同意。"
        ),
    },
}


def text(language: str | None, key: str, **kwargs: object) -> str:
    language_table = TEXT.get(language or DEFAULT_LANGUAGE) or TEXT[DEFAULT_LANGUAGE]
    template = language_table.get(key)
    if template is None and language != DEFAULT_LANGUAGE:
        template = TEXT[DEFAULT_LANGUAGE].get(key)
    if template is None:
        template = key
    try:
        return template.format(**kwargs)
    except (IndexError, KeyError):
        return template
