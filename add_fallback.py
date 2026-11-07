import pathlib

hermes_home = pathlib.Path(r"C:\Users\luiza\AppData\Local\hermes")
config_files = [hermes_home / "config.yaml"]
config_files.extend((hermes_home / "profiles").glob("*/config.yaml"))

fallback_block = [
    "fallback_providers:",
    "  - provider: gemini",
    '    model: "gemini-3.5-flash"',
    "  - provider: gemini",
    '    model: "gemini-3.8-flash"',
    "  - provider: openai-api",
    '    model: "gpt-4o"'
]

for cfg in config_files:
    if not cfg.exists():
        continue
    lines = cfg.read_text(encoding="utf-8").splitlines()
    novas_linhas = []
    pulando = False
    for l in lines:
        if l.strip().startswith("fallback_providers:"):
            pulando = True
            continue
        if pulando and (l.startswith("  ") or l.strip().startswith("-")):
            continue
        pulando = False
        novas_linhas.append(l)
    novas_linhas.extend(fallback_block)
    cfg.write_text("\n".join(novas_linhas) + "\n", encoding="utf-8")
    print(f"Fallback adicionado a: {cfg}")

print("Todos os perfis e config global foram atualizados com Fallback Multi-LLM!")
