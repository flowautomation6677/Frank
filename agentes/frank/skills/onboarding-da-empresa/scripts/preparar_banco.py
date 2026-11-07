#!/usr/bin/env python3
"""Cria o banco de conhecimento a partir do modelo e mostra o que falta preencher.

Uso:
  python3 preparar_banco.py criar --banco PASTA [--modelo PASTA]
  python3 preparar_banco.py situacao --banco PASTA

criar     copia os arquivos do modelo que estiverem faltando em PASTA
          (nunca sobrescreve o banco do dono). O que sobrou como {{MARCADOR}} vira
          "a definir pelo dono".
situacao  diz, por bloco do onboarding, quantos itens ainda estão "a definir pelo dono"
          e se existe um briefing.md antigo ao lado do banco para aproveitar.
"""
import argparse
import os
import tempfile
import pathlib
import re
import sys

A_DEFINIR = "a definir pelo dono"
MARCADOR = re.compile(r"\{\{([A-Z0-9_]+)(?::\s*([^}]*))?\}\}")
# Valor padrão que o instalador grava quando o dono deixa o campo em branco na página.
PADROES_DO_INSTALADOR = (
    "ainda não informado; pergunte ao dono antes de escrever qualquer texto de venda",
)

BLOCOS = [
    ("1. Dados básicos", ["empresa.md"]),
    ("2. Oferta", ["produtos-e-precos.md", "oferta-atual.md"]),
    ("3. Cliente ideal", ["publico-e-dores.md", "perguntas-frequentes.md"]),
    ("4. Marca, tom de voz e promessas", ["voz-da-marca.md", "provas-e-depoimentos.md"]),
    ("5. Canais", ["canais-e-integracoes.md"]),
    ("6. Regras do time", ["regras-da-casa.md"]),
    ("7. Metas e momento", ["empresa.md", "oferta-atual.md"]),
    ("8. Concorrentes e referências", ["empresa.md"]),
]


def trocar_marcadores(texto):
    linhas = []
    for linha in texto.splitlines():
        if not linha.lstrip().startswith(">"):  # nota "Como preencher" fica como está
            linha = MARCADOR.sub(
                lambda m: f"{A_DEFINIR} ({m.group(2).strip()})" if m.group(2) else A_DEFINIR, linha
            )
            for padrao in PADROES_DO_INSTALADOR:
                linha = linha.replace(padrao, A_DEFINIR)
        linhas.append(linha)
    return "\n".join(linhas) + "\n"


def criar(banco, modelo):
    if not modelo.is_dir():
        sys.exit(f"Modelo não encontrado: {modelo}")
    banco.mkdir(parents=True, exist_ok=True)
    for arq in sorted(modelo.glob("*.md")):
        destino = banco / arq.name
        if destino.exists():
            continue
        # Só publica um arquivo completo, sem substituir uma edição concorrente.
        fd, temporario = tempfile.mkstemp(prefix=".banco-", dir=banco)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as saida:
                saida.write(trocar_marcadores(arq.read_text(encoding="utf-8")))
                saida.flush()
                os.fsync(saida.fileno())
            try:
                os.link(temporario, destino)
            except FileExistsError:
                pass
        finally:
            os.unlink(temporario)
    print(f"Banco criado em {banco} com {len(list(banco.glob('*.md')))} arquivos.")
    situacao(banco)


def pendentes(arq):
    if not arq.is_file():
        return None
    return sum(1 for l in arq.read_text(encoding="utf-8").splitlines()
               if A_DEFINIR in l and not l.lstrip().startswith(">"))


def situacao(banco):
    if not banco.is_dir() or not list(banco.glob("*.md")):
        print(f"O banco ainda não existe em {banco}. Rode: preparar_banco.py criar --banco {banco}")
        return
    print("Itens a definir pelo dono, por bloco do onboarding:")
    for nome, arquivos in BLOCOS:
        partes = []
        for a in arquivos:
            n = pendentes(banco / a)
            partes.append(f"{a}: {'arquivo ausente' if n is None else n}")
        print(f"  {nome}: " + "; ".join(partes))
    briefing = banco.parent / "briefing.md"
    if briefing.is_file():
        texto = briefing.read_text(encoding="utf-8")
        m = re.search(r"Situação do onboarding:\s*(.+)", texto)
        print(f"Briefing antigo encontrado: {briefing.name} (onboarding: {m.group(1).strip() if m else 'sem situação'}). "
              "Aproveite o que ele tem antes de perguntar.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("acao", choices=["criar", "situacao"])
    ap.add_argument("--banco", required=True, help="pasta do banco (config banco.dir)")
    ap.add_argument("--modelo", help="pasta do modelo (padrão: references/modelo desta skill)")
    a = ap.parse_args()
    banco = pathlib.Path(a.banco).expanduser()
    modelo = pathlib.Path(a.modelo).expanduser() if a.modelo else pathlib.Path(__file__).resolve().parent.parent / "references" / "modelo"
    criar(banco, modelo) if a.acao == "criar" else situacao(banco)


if __name__ == "__main__":
    main()
