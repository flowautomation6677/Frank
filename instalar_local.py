#!/usr/bin/env python3
"""Instalador local do Time do Frank: o Frank e os 7 assistentes no próprio computador (Mac ou Windows), sem VPS.

Quem chama é o script de entrada de cada sistema (local-mac.sh ou local-win.ps1), depois de instalar o Hermes,
com o Python que o próprio Hermes traz. Só usa a biblioteca padrão.

Uso: python instalar_local.py --hermes CAMINHO_DO_HERMES [--respostas CÓDIGO] [--area-de-trabalho PASTA] [--pacote PASTA]
O código também pode vir em TDF_RESPOSTAS. Sem código, o instalador pede.

Variáveis só para teste: TDF_BASE_URL, TDF_TELEGRAM_API, TDF_PASTA, TDF_PAINEL_PORTA, TDF_API_PORTA,
TDF_ROTULO_PAINEL (Mac), TDF_SEM_SERVICO_HERMES=1 (não instala o serviço do gateway).
"""
import argparse
import base64
import getpass
import hashlib
import json
import os
import pathlib
import platform
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request

VERSAO = "1.0"
PACOTE_VERSAO = "0.3.10"
BASE_URL = os.environ.get("TDF_BASE_URL", "https://instalar.7dsecrets.com").rstrip("/")
TG_API = os.environ.get("TDF_TELEGRAM_API", "https://api.telegram.org").rstrip("/")
FUSO = os.environ.get("FUSO", "America/Sao_Paulo")
AGENTES = ["frank", "renata", "breno", "marina", "lara", "vitor", "ulisses", "isabela"]
PLUGIN_CLAUDE = "claude-subscription-directsdk-experimental"
BANCO_DA_VPS = "/home/hermes/empresa/banco"
EMPRESA = ["NOME_DO_DONO", "NOME_DA_EMPRESA", "O_QUE_A_EMPRESA_VENDE", "PUBLICO", "TOM_DE_VOZ", "PALAVRAS_PROIBIDAS"]
GUARDADAS = EMPRESA + ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USERS", "CEREBRO", "CEREBRO_CHAVE", "CEREBRO_URL",
                       "MODELO", "ESFORCO", "GEMINI_API_KEY"]
NO_WINDOWS = os.name == "nt"
NO_MAC = sys.platform == "darwin"
SISTEMA = "Windows" if NO_WINDOWS else "Mac" if NO_MAC else platform.system()

CASA = pathlib.Path.home()
if NO_WINDOWS:
    LOCAL_APPDATA = pathlib.Path(os.environ.get("LOCALAPPDATA") or CASA / "AppData" / "Local")
    HERMES_HOME = pathlib.Path(os.environ.get("HERMES_HOME") or LOCAL_APPDATA / "hermes")
    PASTA = pathlib.Path(os.environ.get("TDF_PASTA") or LOCAL_APPDATA / "TimeDoFrank")
else:
    HERMES_HOME = pathlib.Path(os.environ.get("HERMES_HOME") or CASA / ".hermes")
    PASTA = pathlib.Path(os.environ.get("TDF_PASTA") or CASA / ".time-do-frank")
PACOTE = PASTA / "pacote"
PERSONALIZADOS = PASTA / "personalizados"
PAINEL_DADOS = PASTA / "painel"
PAINEL_ENV = PAINEL_DADOS / "painel.env"
BANCO = CASA / "empresa" / "banco"
RESPOSTAS_GUARDADAS = PASTA / "respostas.json"
LOG = PASTA / "instalador-local.log"
ROTULO_PAINEL = os.environ.get("TDF_ROTULO_PAINEL", "com.timedofrank.painel")

# ---------- saída na tela ----------
if NO_WINDOWS:
    os.system("")  # liga as cores ANSI no console do Windows
for fluxo in (sys.stdout, sys.stderr):
    try:
        fluxo.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PASSO = 0
AVISOS = 0
PENDENCIAS = []


def registrar(texto):
    try:
        with open(LOG, "a", encoding="utf-8") as arq:
            arq.write(texto.rstrip("\n") + "\n")
    except OSError:
        pass


def passo(texto):
    global PASSO
    PASSO += 1
    print(f"\n\033[1;33m[{PASSO}] {texto}\033[0m", flush=True)
    registrar(f"=== [{PASSO}] {texto}")


def ok(texto):
    print(f"    \033[32mok\033[0m {texto}", flush=True)


def aviso(texto):
    global AVISOS
    AVISOS += 1
    print(f"    \033[33maviso:\033[0m {texto}", flush=True)
    registrar(f"AVISO: {texto}")


def dica(texto):
    print(f"    \033[2m{texto}\033[0m", flush=True)


class Parou(Exception):
    pass


def falha(texto):
    raise Parou(texto)


def bipe():
    print("\a", end="", flush=True)


def esperar_enter(texto):
    bipe()
    try:
        input(f"    {texto}")
    except EOFError:
        pass


def sim_ou_nao(pergunta, padrao="s"):
    try:
        resposta = input(f"    {pergunta} ").strip() or padrao
    except EOFError:
        resposta = padrao
    return resposta[:1].lower() in ("s", "y")


# ---------- comandos ----------
AMBIENTE = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
HERMES = ""


def comando_de(programa):
    # .cmd e .bat só rodam pelo cmd.exe.
    if NO_WINDOWS and str(programa).lower().endswith((".cmd", ".bat")):
        return ["cmd", "/c", str(programa)]
    return [str(programa)]


def rodar(argumentos, timeout=None, interativo=False, entrada=None):
    """Roda um comando e devolve (código, saída). Interativo usa o terminal do aluno; o resto vai para o registro."""
    registrar("$ " + " ".join(str(a) for a in argumentos))
    try:
        if interativo:
            return subprocess.run(argumentos, env=AMBIENTE, timeout=timeout).returncode, ""
        r = subprocess.run(argumentos, env=AMBIENTE, timeout=timeout, input=entrada, stdin=None if entrada else subprocess.DEVNULL,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
        registrar(r.stdout[-4000:])
        return r.returncode, r.stdout
    except subprocess.TimeoutExpired:
        registrar("(passou do tempo)")
        return 124, ""
    except OSError as erro:
        registrar(f"(não rodou: {erro})")
        return 127, ""


def hermes(*argumentos, perfil=None, timeout=600, interativo=False):
    base = comando_de(HERMES) + (["-p", perfil] if perfil else [])
    return rodar(base + [str(a) for a in argumentos], timeout=timeout, interativo=interativo)


def grava_env(perfil, chave, valor):
    """Troca a linha CHAVE= do .env do perfil (default é o perfil-base; painel é o .env do painel). Valor vazio apaga."""
    if perfil == "default":
        arq = HERMES_HOME / ".env"
    elif perfil == "painel":
        arq = PAINEL_ENV
    else:
        arq = HERMES_HOME / "profiles" / perfil / ".env"
    if not arq.parent.is_dir():
        return
    linhas = arq.read_text(encoding="utf-8").splitlines() if arq.exists() else []
    linhas = [l for l in linhas if not l.startswith(chave + "=")]
    if valor:
        linhas.append(f"{chave}={valor}")
    novo = arq.with_name(arq.name + ".novo")
    novo.write_text("\n".join(linhas) + ("\n" if linhas else ""), encoding="utf-8")
    if not NO_WINDOWS:
        os.chmod(novo, 0o600)
    os.replace(novo, arq)


def baixar(url, destino=None, timeout=600):
    pedido = urllib.request.Request(url, headers={"User-Agent": f"time-do-frank-local/{VERSAO}"})
    with urllib.request.urlopen(pedido, timeout=timeout) as resp:
        dados = resp.read()
    if destino:
        pathlib.Path(destino).write_bytes(dados)
    return dados


# ---------- código de respostas do manual ----------
# Formato: base64 de linhas CHAVE=valor-em-base64; a primeira "V=1" e a última "FIM=" (sem ela, a colagem cortou o código).
R = {k: "" for k in GUARDADAS}
RESPONDIDAS = set()


def aplicar_codigo(codigo):
    try:
        texto = base64.b64decode(re.sub(r"\s", "", codigo), validate=True).decode("utf-8")
    except Exception:
        return False
    linhas = texto.split("\n")
    if not linhas or linhas[0] != "V=1" or linhas[-1] != "FIM=":
        return False
    valores = {}
    for linha in linhas[1:-1]:
        m = re.fullmatch(r"([A-Z_]+)=([A-Za-z0-9+/]*=*)", linha)
        if not m:
            return False
        if m.group(1) not in GUARDADAS:
            continue
        try:
            valor = base64.b64decode(m.group(2)).decode("utf-8")
        except Exception:
            return False
        if len(valor) > 1000 or any(ord(c) < 32 for c in valor):
            return False
        valores[m.group(1)] = valor
    for chave, valor in valores.items():
        if not valor and chave in ("NOME_DO_DONO", "NOME_DA_EMPRESA"):
            continue
        R[chave] = valor
        RESPONDIDAS.add(chave)
    return True


def pedir_codigo():
    print("    Cole o código de respostas do manual e aperte Enter (ele não aparece na tela).")
    for _ in range(3):
        try:
            codigo = getpass.getpass("    Código: ")
        except EOFError:
            codigo = ""
        if codigo.strip() and aplicar_codigo(codigo):
            return True
        aviso("esse código não veio inteiro. No manual, clique em Copiar de novo e cole aqui.")
    return False


# ---------- Telegram ----------
def tg(metodo, **params):
    url = f"{TG_API}/bot{R['TELEGRAM_BOT_TOKEN']}/{metodo}"
    dados = urllib.parse.urlencode(params).encode() if params else None
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=dados), timeout=40) as resp:
            return json.load(resp)
    except Exception as erro:
        registrar(f"telegram {metodo}: {erro.__class__.__name__}")
        return {}


BOT_USUARIO = ""


def conferir_bot():
    global BOT_USUARIO
    resp = tg("getMe")
    BOT_USUARIO = (resp.get("result") or {}).get("username", "") if resp.get("ok") else ""
    return bool(BOT_USUARIO)


def conferir_telegram():
    if not R["TELEGRAM_BOT_TOKEN"]:
        aviso("Telegram ficou para depois.")
        PENDENCIAS.append("Telegram: no passo 2 do manual, crie o bot, copie a linha de novo e cole aqui")
        return
    if not re.fullmatch(r"[0-9]{5,}:[A-Za-z0-9_-]{30,}", R["TELEGRAM_BOT_TOKEN"]) or not conferir_bot():
        aviso("o Telegram não reconheceu o token do bot. Confira o passo 2 do manual.")
        R["TELEGRAM_BOT_TOKEN"] = R["TELEGRAM_ALLOWED_USERS"] = ""
        PENDENCIAS.append("Telegram: confira o token no passo 2 do manual, copie a linha de novo e cole aqui")
        return
    if not re.fullmatch(r"[0-9]+", R["TELEGRAM_ALLOWED_USERS"] or ""):
        # Sem o ID do dono, qualquer pessoa poderia mandar ordens ao Frank.
        aviso("sem o seu ID do Telegram, o Telegram fica desligado.")
        R["TELEGRAM_BOT_TOKEN"] = R["TELEGRAM_ALLOWED_USERS"] = ""
        PENDENCIAS.append("Telegram: no passo 2 do manual, mande o oi para o bot, copie a linha de novo e cole aqui")
        return
    ok(f"bot @{BOT_USUARIO}; dono: ID {R['TELEGRAM_ALLOWED_USERS']}")


# ---------- cérebro ----------
def dados_do_cerebro(cerebro):
    c = {"provedor": "", "acesso": "", "var": "", "fixo": "", "nome": ""}
    tabela = {
        "chatgpt": ("openai-codex", "login", "", "", "ChatGPT (sua assinatura)"),
        "grok": ("xai-oauth", "login", "", "", "Grok (sua assinatura)"),
        "claude-assinatura": (PLUGIN_CLAUDE, "login", "", "sonnet", "Claude (sua assinatura)"),
        "claude": ("anthropic", "chave", "ANTHROPIC_API_KEY", "claude-sonnet-5", "Claude (chave de API)"),
        "gemini": ("gemini", "chave", "GEMINI_API_KEY", "", "Gemini (chave de API)"),
        "ollama": ("ollama-cloud", "chave", "OLLAMA_API_KEY", "", "Ollama Cloud"),
        "openrouter": ("openrouter", "chave", "OPENROUTER_API_KEY", "", "OpenRouter"),
        "openai": ("openai-api", "chave", "OPENAI_API_KEY", "", "OpenAI (chave de API)"),
        "deepseek": ("deepseek", "chave", "DEEPSEEK_API_KEY", "", "DeepSeek"),
        "xai": ("xai", "chave", "XAI_API_KEY", "", "xAI (chave de API)"),
        "compativel": ("custom", "chave", "TDF_CUSTOM_API_KEY", "", "servidor compatível com OpenAI"),
    }
    if cerebro in tabela:
        c["provedor"], c["acesso"], c["var"], c["fixo"], c["nome"] = tabela[cerebro]
    else:
        c["acesso"], c["nome"] = "nenhum", "ainda não ligado"
    return c


def conferir_cerebro():
    c = dados_do_cerebro(R["CEREBRO"])
    if c["acesso"] == "chave" and not R["CEREBRO_CHAVE"]:
        aviso("o cérebro escolhido precisa de chave, e ela não veio no código.")
        R["CEREBRO"] = "depois"
        c = dados_do_cerebro("depois")
    if R["CEREBRO"] == "compativel" and not (R["CEREBRO_URL"] and R["MODELO"]):
        aviso("o servidor compatível precisa do endereço e do nome do modelo.")
        R["CEREBRO"] = "depois"
        c = dados_do_cerebro("depois")
    if R["CEREBRO"] == "claude-assinatura" and not re.fullmatch(r"haiku|sonnet|opus|fable|claude-.*", R["MODELO"] or ""):
        R["MODELO"] = ""
    if c["fixo"] and not R["MODELO"]:
        R["MODELO"] = c["fixo"]
    if R["ESFORCO"] not in ("low", "medium", "high", "xhigh"):
        R["ESFORCO"] = "medium"
    if R["CEREBRO"] == "gemini" and not R["GEMINI_API_KEY"]:
        R["GEMINI_API_KEY"] = R["CEREBRO_CHAVE"]
    if c["acesso"] == "nenhum":
        PENDENCIAS.append("Cérebro: no passo 4 do manual, escolha o cérebro, copie a linha de novo e cole aqui")
        aviso("cérebro fica para depois.")
    else:
        ok(f"cérebro: {c['nome']}; modelo: {nome_do_modelo()}; esforço: {nome_do_esforco()}")


def nome_do_modelo():
    if R["MODELO"]:
        return R["MODELO"]
    return "automático" if R["CEREBRO"] == "ollama" else "padrão do Hermes"


def nome_do_esforco():
    return {"low": "baixo", "high": "alto", "xhigh": "máximo"}.get(R["ESFORCO"], "médio")


# ---------- pacote ----------
def baixar_pacote(pacote_local):
    novo = PASTA / "pacote.novo"
    shutil.rmtree(novo, ignore_errors=True)
    if pacote_local:
        shutil.copytree(pacote_local, novo)
    else:
        url = f"{BASE_URL}/time-do-frank-{PACOTE_VERSAO}.tar.gz"
        try:
            dados = baixar(url)
            esperado = baixar(url + ".sha256", timeout=60).decode().split()[0]
        except Exception as erro:
            registrar(f"pacote: {erro}")
            falha("não consegui baixar o pacote dos agentes. Confira a internet e cole a linha de novo.")
        if hashlib.sha256(dados).hexdigest() != esperado.lower():
            falha("o pacote baixado não confere. Não instalei nada dele. Cole a linha de novo.")
        novo.mkdir(parents=True)
        arquivo = PASTA / "pacote.tar.gz"
        arquivo.write_bytes(dados)
        with tarfile.open(arquivo) as tar:
            tar.extractall(novo, filter="data")
        arquivo.unlink()
    for a in AGENTES:
        if not (novo / "agentes" / a / "distribution.yaml").is_file():
            falha(f"o pacote não tem o agente {a}.")
    shutil.rmtree(PACOTE, ignore_errors=True)
    novo.rename(PACOTE)
    ok("pacote dos agentes e do painel de voz")


# ---------- Hermes: extras ----------
def python_do_hermes_com_modulos(codigo, ambiente_extra=None, timeout=900):
    """Roda código com os módulos do Hermes (faster-whisper, catálogo de modelos) no Python do próprio Hermes."""
    codigo_r, saida = rodar(comando_de(HERMES) + ["--print-runtime-command"], timeout=60)
    try:
        python = json.loads(saida.strip().splitlines()[-1])[0]
    except Exception:
        return 1, ""
    fonte = HERMES_HOME / "hermes-agent"
    preambulo = (
        "import os, sys\n"
        f"sys.path.insert(0, {str(fonte)!r}); sys._hermes_pin_default_home = True\n"
        "import hermes_bootstrap\n"
    )
    global AMBIENTE
    anterior = AMBIENTE
    AMBIENTE = dict(AMBIENTE, **(ambiente_extra or {}))
    try:
        return rodar([python, "-I", "-c", preambulo + codigo], timeout=timeout)
    finally:
        AMBIENTE = anterior


def instalar_extras():
    maquina = platform.machine().lower()
    if (NO_MAC and maquina == "x86_64") or (NO_WINDOWS and maquina in ("arm64", "aarch64")):
        # O Hermes não traz o faster-whisper para Mac Intel nem Windows ARM.
        aviso("neste computador, o Frank não transcreve áudio do Telegram; mande os pedidos por texto.")
    else:
        instalar_transcricao()
    r, _ = hermes("pm", "install", "agent-browser", timeout=1800)
    if r == 0:
        ok("navegador do Frank")
    else:
        aviso("o navegador do Frank não instalou; o resto segue.")
        PENDENCIAS.append("Navegador do Frank: cole a mesma linha do manual de novo (o que já está pronto fica)")


def instalar_transcricao():
    hermes("pm", "install", "--extra", "voice", timeout=1800)
    r, _ = python_do_hermes_com_modulos(
        "from faster_whisper import WhisperModel\nWhisperModel('base', device='cpu', compute_type='int8')\n")
    if r == 0:
        ok("transcrição dos áudios do Telegram ligada")
    else:
        aviso("a transcrição dos áudios não instalou; o resto segue.")
        PENDENCIAS.append("Áudio no Telegram: cole a mesma linha do manual de novo (o que já está pronto fica)")


# ---------- agentes ----------
def personalizar_agentes():
    c = dados_do_cerebro(R["CEREBRO"])
    novo = PERSONALIZADOS.with_name(PERSONALIZADOS.name + ".novo")
    shutil.rmtree(novo, ignore_errors=True)
    shutil.copytree(PACOTE / "agentes", novo)
    marcadores = {k: R[k] for k in EMPRESA}
    banco = BANCO.as_posix()
    for arq in novo.rglob("*"):
        if arq.is_file() and arq.suffix in (".md", ".txt", ".yaml", ".yml"):
            texto = arq.read_text(encoding="utf-8")
            trocado = texto.replace(BANCO_DA_VPS, banco)
            if arq.suffix in (".md", ".txt"):
                for chave, valor in marcadores.items():
                    trocado = trocado.replace("{{%s}}" % chave, valor)
            if trocado != texto:
                arq.write_text(trocado, encoding="utf-8")
    for cfg in novo.glob("*/config.yaml"):
        linhas = [l for l in cfg.read_text(encoding="utf-8").splitlines() if not l.startswith("timezone:")]
        cfg.write_text("\n".join(linhas + ["timezone: " + json.dumps(FUSO)]) + "\n", encoding="utf-8")
    if c["provedor"]:
        bloco = ["model:", f"  provider: {c['provedor']}", "  default: " + json.dumps(R["MODELO"])]
        if c["provedor"] == "custom":
            bloco += ["  base_url: " + json.dumps(R["CEREBRO_URL"]), '  api_key: "${TDF_CUSTOM_API_KEY}"']
        for cfg in novo.glob("*/config.yaml"):
            linhas, saida, dentro = cfg.read_text(encoding="utf-8").splitlines(), [], False
            for linha in linhas:
                if linha.startswith("model:"):
                    dentro = True
                    saida += bloco
                    continue
                if dentro and (linha.startswith((" ", "\t")) or not linha.strip()):
                    continue
                dentro = False
                saida.append(linha)
            if "model:" not in [l.split("#")[0].strip() for l in linhas]:
                saida += bloco
            cfg.write_text("\n".join(saida) + "\n", encoding="utf-8")
    for cfg in novo.glob("*/config.yaml"):
        linhas, saida, dentro, gravado = cfg.read_text(encoding="utf-8").splitlines(), [], False, False
        for linha in linhas:
            if linha.startswith("agent:"):
                dentro = True
                saida += [linha, "  reasoning_effort: " + json.dumps(R["ESFORCO"])]
                gravado = True
                continue
            if dentro and linha.strip().startswith("reasoning_effort:") and linha.startswith("  ") and not linha.startswith("   "):
                continue
            if dentro and linha.strip() and not linha.startswith((" ", "\t")):
                dentro = False
            saida.append(linha)
        if not gravado:
            saida += ["agent:", "  reasoning_effort: " + json.dumps(R["ESFORCO"])]
        cfg.write_text("\n".join(saida) + "\n", encoding="utf-8")
    shutil.rmtree(PERSONALIZADOS, ignore_errors=True)
    novo.rename(PERSONALIZADOS)


def semear_banco():
    script = PERSONALIZADOS / "frank" / "skills" / "onboarding-da-empresa" / "scripts" / "preparar_banco.py"
    BANCO.parent.mkdir(parents=True, exist_ok=True)
    r, _ = rodar([sys.executable, str(script), "criar", "--banco", str(BANCO)], timeout=120)
    if r == 0:
        ok(f"banco de conhecimento da empresa: {len(list(BANCO.glob('*.md')))} arquivos")
    else:
        aviso("não consegui criar o banco da empresa; o Frank cria na primeira conversa.")


def versao_no_selo(selo):
    try:
        return str(json.loads(selo.read_text(encoding="utf-8-sig")).get("baseVersion") or "")
    except Exception:
        return ""


def conferir_versao_do_hermes():
    """O Hermes grava a própria versão no install-stamp.json lendo as tags do git com limite de 3 s. Num computador
    ocupado o git estoura esse limite, a versão fica "unknown" para sempre e o profile install recusa os agentes
    ("Unparseable version: 'unknown'"). Regrava o selo com o git já aquecido."""
    fonte = HERMES_HOME / "hermes-agent"
    selo = fonte / "install-stamp.json"
    if not selo.exists() or re.match(r"\d", versao_no_selo(selo)):
        return
    for tentativa in range(3):
        if tentativa:
            rodar(["git", "-C", str(fonte), "fetch", "--tags", "--quiet", "origin"], timeout=300)
        python_do_hermes_com_modulos(
            "from pathlib import Path\n"
            "from hermes_cli.source_stamp import write_source_stamp\n"
            f"selo = write_source_stamp(Path({str(fonte)!r}))\n"
            "print('versão do Hermes no selo:', selo and selo.get('baseVersion'))\n", timeout=120)
        if re.match(r"\d", versao_no_selo(selo)):
            ok("versão do Hermes conferida")
            return
        time.sleep(5)
    # O instalador já fixa a versão testada do Hermes; sem versão no selo, a exigência só barraria os agentes.
    for manifesto in PERSONALIZADOS.glob("*/distribution.yaml"):
        texto = manifesto.read_text(encoding="utf-8")
        manifesto.write_text(re.sub(r"(?m)^hermes_requires:.*\n?", "", texto), encoding="utf-8")
    registrar("selo do Hermes sem versão: agentes instalados sem exigir versão")


def instalar_agentes(mostrar=True):
    personalizar_agentes()
    if mostrar:
        semear_banco()
    conferir_versao_do_hermes()
    for a in AGENTES:
        if (HERMES_HOME / "profiles" / a).is_dir():
            r, _ = hermes("profile", "install", PERSONALIZADOS / a, "--yes", "--force")
            if r != 0:
                hermes("profile", "update", a, "--force-config")
        else:
            r, _ = hermes("profile", "install", PERSONALIZADOS / a, "--yes")
            if r != 0:
                falha(f"não consegui instalar o agente {a}. Cole a linha de novo.")
        descricao = (PERSONALIZADOS / a / "DESCRICAO.txt").read_text(encoding="utf-8").strip()
        hermes("profile", "describe", a, "--text", descricao)
        if mostrar:
            ok(a)


def aplicar_cerebro():
    c = dados_do_cerebro(R["CEREBRO"])
    perfis = ["default"] + AGENTES
    for v in ("ANTHROPIC_API_KEY", "OLLAMA_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY",
              "XAI_API_KEY", "TDF_CUSTOM_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY"):
        for p in perfis:
            grava_env(p, v, "")
    if c["acesso"] == "chave" and R["CEREBRO_CHAVE"]:
        for p in perfis:
            grava_env(p, c["var"], R["CEREBRO_CHAVE"])
    hermes("config", "set", "timezone", FUSO)
    hermes("config", "set", "display.language", "pt")
    hermes("config", "set", "stt.language", "pt")
    if not c["provedor"]:
        return
    if c["provedor"] == PLUGIN_CLAUDE:
        instalar_claude_code()
        instalar_plugin_claude()
    hermes("config", "set", "model.provider", c["provedor"])
    hermes("config", "set", "model.default", R["MODELO"])
    hermes("config", "set", "agent.reasoning_effort", R["ESFORCO"])
    if c["provedor"] == "custom":
        hermes("config", "set", "model.base_url", R["CEREBRO_URL"])
        hermes("config", "set", "model.api_key", "${TDF_CUSTOM_API_KEY}")
    else:
        for chave in ("model.base_url", "model.api_key", "model.api_mode"):
            hermes("config", "unset", chave)


def caminho_do_claude():
    nome = "claude.exe" if NO_WINDOWS else "claude"
    candidato = CASA / ".local" / "bin" / nome
    return candidato if candidato.exists() else shutil.which("claude")


def instalar_claude_code():
    if caminho_do_claude():
        return True
    if NO_WINDOWS:
        rodar(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://claude.ai/install.ps1 | iex"], timeout=900)
    else:
        rodar(["bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"], timeout=900)
    if caminho_do_claude():
        ok("Claude Code instalado")
        return True
    aviso("não consegui instalar o Claude Code.")
    return False


def instalar_plugin_claude():
    base = HERMES_HOME / "plugins" / PLUGIN_CLAUDE
    if not base.is_dir():
        hermes("plugins", "install", "claude-subscription-directsdk")
    if not base.is_dir():
        aviso("não consegui instalar o plugin da assinatura do Claude.")
        return
    for a in AGENTES:
        destino = HERMES_HOME / "profiles" / a / "plugins" / PLUGIN_CLAUDE
        shutil.rmtree(destino, ignore_errors=True)
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(base, destino)


def ja_logado(provedor):
    if provedor == PLUGIN_CLAUDE:
        claude = caminho_do_claude()
        if not claude:
            return False
        _, saida = rodar(comando_de(claude) + ["auth", "status"], timeout=60)
        return bool(re.search(r'"loggedIn":\s*true', saida))
    _, saida = hermes("auth", "status", provedor, timeout=60)
    return bool(re.search(rf"^{re.escape(provedor)}: logged in", saida, re.M))


def login_cerebro():
    c = dados_do_cerebro(R["CEREBRO"])
    if c["acesso"] != "login":
        return True
    if ja_logado(c["provedor"]):
        ok(f"login do {c['nome']} já feito")
        return True
    print()
    esperar_enter(f"Hora do login do {c['nome']}. Aperte Enter quando estiver na frente da tela.")
    if R["CEREBRO"] == "claude-assinatura":
        print("    O navegador abre a página do Claude. Entre com a conta do seu Claude Pro ou Max e autorize.")
        print("    Se o navegador não abrir, copie o endereço que aparecer aqui e abra no navegador. Se o site mostrar")
        print("    um código, copie e cole aqui quando pedir.")
        if not instalar_claude_code():
            return False
        try:
            rodar(comando_de(caminho_do_claude()) + ["auth", "login", "--claudeai"], timeout=900, interativo=True)
        except KeyboardInterrupt:
            print()
    else:
        print("    Vai aparecer um endereço e um código. Abra o endereço no navegador, entre com a sua conta")
        print("    e confirme o código. Depois volte aqui. Para desistir do login, aperte Ctrl+C: a instalação continua.")
        try:
            hermes("auth", "add", c["provedor"], "--type", "oauth", "--no-browser", timeout=900, interativo=True)
        except KeyboardInterrupt:
            print()
    if ja_logado(c["provedor"]):
        ok(f"login do {c['nome']} feito")
        return True
    aviso("o login não terminou.")
    return False


RESPOSTA_DO_FRANK = ""


def testar_cerebro():
    global RESPOSTA_DO_FRANK
    retorno, saida = hermes("chat", "-Q", "-q", "Responda apenas com a palavra: pronto", perfil="frank", timeout=180)
    linhas = [l for l in saida.splitlines() if not re.search(r"responda|palavra", l, re.I)]
    RESPOSTA_DO_FRANK = "pronto" if retorno == 0 and any(re.fullmatch(r"\s*pronto[.!]?\s*", l, re.I) for l in linhas) else ""
    return bool(RESPOSTA_DO_FRANK)


def modelos_do_ollama():
    r, saida = python_do_hermes_com_modulos(
        "from hermes_cli.models import fetch_ollama_cloud_models\n"
        "from agent.models_dev import list_agentic_models\n"
        "vivos = fetch_ollama_cloud_models(api_key=os.environ['OLLAMA_API_KEY'], force_refresh=True)\n"
        "for m in [m for m in list_agentic_models('ollama-cloud') if m in vivos] + vivos:\n    print(m)\n",
        ambiente_extra={"OLLAMA_API_KEY": R["CEREBRO_CHAVE"]}, timeout=120)
    modelos = [l.strip() for l in saida.splitlines() if re.fullmatch(r"[\w.:/-]+", l.strip())] if r == 0 else []
    return (modelos or ["glm-5.3", "kimi-k3", "deepseek-v4-pro"])[:5]


def ligar_cerebro():
    c = dados_do_cerebro(R["CEREBRO"])
    if c["acesso"] == "nenhum":
        return
    if not login_cerebro():
        PENDENCIAS.append(f"Cérebro: o login do {c['nome']} não terminou; cole a mesma linha do manual de novo")
        return
    if R["CEREBRO"] == "ollama" and R["MODELO"] and not testar_cerebro():
        aviso(f"o modelo {R['MODELO']} não respondeu na sua conta do Ollama. Vou testar outros.")
        R["MODELO"] = ""
    if R["CEREBRO"] == "ollama" and not R["MODELO"]:
        for m in modelos_do_ollama():
            R["MODELO"] = m
            instalar_agentes(mostrar=False)
            aplicar_cerebro()
            if testar_cerebro():
                break
            R["MODELO"] = ""
    if RESPOSTA_DO_FRANK or testar_cerebro():
        ok(f"o Frank respondeu: {RESPOSTA_DO_FRANK}")
        return
    if R["CEREBRO"] not in ("ollama", "compativel") and R["MODELO"] and R["MODELO"] != c["fixo"]:
        aviso(f"o modelo {R['MODELO']} não respondeu. Vou tentar o modelo padrão do {c['nome']}.")
        R["MODELO"] = c["fixo"]
        instalar_agentes(mostrar=False)
        aplicar_cerebro()
        if testar_cerebro():
            ok(f"o Frank respondeu: {RESPOSTA_DO_FRANK} (modelo: {nome_do_modelo()})")
            return
    aviso(f"o {c['nome']} não respondeu. Causas comuns: chave errada, conta sem crédito, assinatura sem acesso "
          "ou modelo que a sua conta não libera.")
    PENDENCIAS.append("Cérebro: confira o passo 4 do manual, copie a linha de novo e cole aqui")


# ---------- Telegram, quadro e rotinas ----------
def gravar_telegram():
    grava_env("frank", "TELEGRAM_BOT_TOKEN", R["TELEGRAM_BOT_TOKEN"])
    grava_env("frank", "TELEGRAM_ALLOWED_USERS", R["TELEGRAM_ALLOWED_USERS"])
    grava_env("frank", "TELEGRAM_HOME_CHANNEL", R["TELEGRAM_ALLOWED_USERS"])
    if "TDF_TELEGRAM_API" in os.environ:  # só no teste: o bot conversa com o Telegram falso
        hermes("config", "set", "platforms.telegram.extra.base_url", TG_API + "/bot", perfil="frank")
        hermes("config", "set", "platforms.telegram.extra.base_file_url", TG_API + "/file/bot", perfil="frank")


def cria_rotina(perfil, nome, horario, entrega, prompt):
    _, lista = hermes("cron", "list", perfil=perfil, timeout=120)
    if re.search(rf"Name:\s*{re.escape(nome)}\s*$", lista, re.M):
        ultimo = ""
        for linha in lista.splitlines():
            partes = linha.split()
            if partes and re.fullmatch(r"[0-9a-f]+", partes[0]):
                ultimo = partes[0]
            if len(partes) >= 2 and partes[0] == "Name:" and partes[1] == nome and ultimo:
                hermes("cron", "edit", ultimo, "--deliver", entrega, perfil=perfil)
                break
        ok(f"rotina {nome} de {perfil} já existe (entrega: {entrega})")
        return
    r, _ = hermes("cron", "create", horario, prompt, "--name", nome, "--deliver", entrega, perfil=perfil)
    if r == 0:
        ok(f"rotina {nome} de {perfil} ({horario})")
    else:
        aviso(f"não consegui criar a rotina {nome} de {perfil}.")


def criar_rotinas():
    entrega = "telegram" if R["TELEGRAM_BOT_TOKEN"] and R["TELEGRAM_ALLOWED_USERS"] else "local"
    cria_rotina("isabela", "numeros-da-manha", "30 7 * * *", "local",
                "Prepare os números de ontem: investido, vendido, conversas novas e o que pausar. "
                "Registre como tarefa concluída no quadro, para o Frank.")
    cria_rotina("frank", "resumo-da-manha", "0 8 * * *", entrega,
                "Monte o resumo da manhã para o dono: o que cada assistente entregou, o que espera aprovação e o que é "
                "decisão dele. Use o quadro de tarefas e os números da Isabela.")


def instalar_comando_de_aviso():
    """time-do-frank avisar: os agentes avisam no grupo do time; no computador ainda não há grupo."""
    texto_sem_grupo = "sem grupo do time: nada enviado"
    if NO_WINDOWS:
        pasta = pathlib.Path(HERMES).parent
        (pasta / "time-do-frank.cmd").write_text(
            "@echo off\r\nif /I \"%~1\"==\"avisar\" (echo " + texto_sem_grupo + "& exit /b 0)\r\n"
            "echo No computador, para trocar algo, cole de novo a linha do manual.\r\n", encoding="ascii")
    else:
        pasta = CASA / ".local" / "bin"
        pasta.mkdir(parents=True, exist_ok=True)
        arq = pasta / "time-do-frank"
        arq.write_text("#!/bin/bash\n[ \"${1:-}\" = avisar ] && { echo \"" + texto_sem_grupo + "\"; exit 0; }\n"
                       "echo \"No computador, para trocar algo, cole de novo a linha do manual.\"\n", encoding="utf-8")
        arq.chmod(0o755)


# ---------- API do Hermes e painel de voz ----------
def porta_livre(inicial):
    for porta in range(inicial, inicial + 21):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", porta)) != 0:
                return porta
    return inicial


GUARDADO = {}
PAINEL_PORTA = 0
API_PORTA = int(os.environ.get("TDF_API_PORTA") or 8642)


def ligar_api_do_hermes():
    GUARDADO.setdefault("CHAVE_API_RAIZ", secrets.token_hex(24))
    GUARDADO.setdefault("CHAVE_API_FRANK", secrets.token_hex(24))
    grava_env("default", "API_SERVER_ENABLED", "true")
    grava_env("default", "API_SERVER_KEY", GUARDADO["CHAVE_API_RAIZ"])
    grava_env("frank", "API_SERVER_KEY", GUARDADO["CHAVE_API_FRANK"])
    if "TDF_API_PORTA" in os.environ:
        grava_env("default", "API_SERVER_PORT", str(API_PORTA))


def versao_do_node(caminho):
    _, saida = rodar([str(caminho), "-v"], timeout=30)
    m = re.match(r"v(\d+)\.(\d+)\.(\d+)", saida.strip())
    return tuple(map(int, m.groups())) if m else (0, 0, 0)


def achar_node():
    nome = "node.exe" if NO_WINDOWS else "node"
    candidatos = sorted((HERMES_HOME / "tools").glob(f"node-*/**/{nome}"), reverse=True)
    candidatos += [pathlib.Path(p) for p in [shutil.which("node")] if p]
    candidatos.append(PASTA / "node" / ("node.exe" if NO_WINDOWS else "bin/node"))
    for c in candidatos:
        if c.is_file() and versao_do_node(c) >= (22, 23, 3):
            return c
    return baixar_node()


def baixar_node():
    versao = "22.23.3"
    maquina = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x64", "amd64": "x64"}.get(platform.machine().lower())
    if not maquina:
        return None
    nome = f"node-v{versao}-{'win' if NO_WINDOWS else 'darwin'}-{maquina}.{'zip' if NO_WINDOWS else 'tar.gz'}"
    try:
        dados = baixar(f"https://nodejs.org/dist/v{versao}/{nome}")
        somas = baixar(f"https://nodejs.org/dist/v{versao}/SHASUMS256.txt", timeout=60).decode()
    except Exception as erro:
        registrar(f"node: {erro}")
        return None
    if f"{hashlib.sha256(dados).hexdigest()}  {nome}" not in somas:
        aviso("o Node baixado não confere; não instalei.")
        return None
    destino = PASTA / "node"
    shutil.rmtree(destino, ignore_errors=True)
    with tempfile.TemporaryDirectory() as tmp:
        arq = pathlib.Path(tmp) / nome
        arq.write_bytes(dados)
        shutil.unpack_archive(str(arq), tmp)
        pasta = next(p for p in pathlib.Path(tmp).iterdir() if p.is_dir())
        shutil.move(str(pasta), str(destino))
    return destino / ("node.exe" if NO_WINDOWS else "bin/node")


def gravar_env_do_painel():
    PAINEL_DADOS.mkdir(parents=True, exist_ok=True)
    if not PAINEL_ENV.exists():
        PAINEL_ENV.write_text("", encoding="utf-8")
    for chave, valor in (("FRANK_HOST", "127.0.0.1"), ("FRANK_PORTA_TUNEL_VARIAVEL", "1"), ("FRANK_PORTA", str(PAINEL_PORTA)),
                         ("FRANK_PASTA_DE_DADOS", str(PAINEL_DADOS / "dados")), ("HERMES_BIN", str(HERMES)),
                         ("HERMES_HOME", str(HERMES_HOME)),
                         ("HERMES_API_URL", f"http://127.0.0.1:{API_PORTA}/p/frank"),
                         ("HERMES_API_KEY", GUARDADO["CHAVE_API_FRANK"]), ("GEMINI_API_KEY", R["GEMINI_API_KEY"]),
                         ("FRANK_NOME_DO_DONO", R["NOME_DO_DONO"]), ("FRANK_NOME_DA_EMPRESA", R["NOME_DA_EMPRESA"])):
        grava_env("painel", chave, valor)


def conferir_painel(segundos=20):
    for _ in range(segundos):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PAINEL_PORTA}/api/saude", timeout=2) as resp:
                if b'"servico":"painel-do-frank"' in resp.read():
                    return True
        except Exception:
            pass
        time.sleep(1)
    return False


def parar_painel_antigo():
    if NO_MAC:
        rodar(["launchctl", "bootout", f"gui/{os.getuid()}/{ROTULO_PAINEL}"], timeout=30)
    elif NO_WINDOWS:
        pid = PAINEL_DADOS / "painel.pid"
        if pid.exists():
            rodar(["taskkill", "/PID", pid.read_text().strip(), "/T", "/F"], timeout=30)
            pid.unlink(missing_ok=True)


def ligar_painel_no_mac(node):
    plist = CASA / "Library" / "LaunchAgents" / f"{ROTULO_PAINEL}.plist"
    plist.parent.mkdir(parents=True, exist_ok=True)
    import plistlib
    plist.write_bytes(plistlib.dumps({
        "Label": ROTULO_PAINEL,
        "ProgramArguments": [str(node), str(PACOTE / "painel" / "server.mjs")],
        "WorkingDirectory": str(PACOTE / "painel"),
        "EnvironmentVariables": {"FRANK_ENV_FILE": str(PAINEL_ENV)},
        "RunAtLoad": True,
        "KeepAlive": True,
        "StandardOutPath": str(PAINEL_DADOS / "painel.log"),
        "StandardErrorPath": str(PAINEL_DADOS / "painel.log"),
    }))
    rodar(["launchctl", "bootstrap", f"gui/{os.getuid()}", str(plist)], timeout=30)


def ligar_painel_no_windows(node):
    # Script de partida na pasta Inicializar do usuário: liga o painel a cada login, sem administrador e sem janela.
    partida = PAINEL_DADOS / "ligar-painel.vbs"
    linha = f'"{node}" "{PACOTE / "painel" / "server.mjs"}"'.replace('"', '""')
    partida.write_text(
        'Set sh = CreateObject("WScript.Shell")\r\n'
        f'sh.Environment("PROCESS")("FRANK_ENV_FILE") = "{PAINEL_ENV}"\r\n'
        f'sh.CurrentDirectory = "{PACOTE / "painel"}"\r\n'
        f'sh.Run "{linha}", 0, False\r\n', encoding="utf-16")
    inicializar = pathlib.Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
    if inicializar.is_dir():
        shutil.copy(partida, inicializar / "Painel do Frank.vbs")
    rodar(["wscript", str(partida)], timeout=30)


def instalar_painel():
    global PAINEL_PORTA
    if not (PACOTE / "painel" / "server.mjs").is_file():
        aviso("o pacote não trouxe o painel de voz.")
        return False
    node = achar_node()
    if not node:
        aviso("não achei nem consegui baixar o Node; o painel de voz fica de fora.")
        PENDENCIAS.append("Voz: cole a mesma linha do manual de novo (o que já está pronto fica)")
        return False
    parar_painel_antigo()
    time.sleep(1)
    PAINEL_PORTA = int(os.environ.get("TDF_PAINEL_PORTA") or porta_livre(8787))
    gravar_env_do_painel()
    if NO_MAC:
        ligar_painel_no_mac(node)
    elif NO_WINDOWS:
        ligar_painel_no_windows(node)
    if conferir_painel():
        ok(f"painel de voz ligado em http://127.0.0.1:{PAINEL_PORTA}")
        return True
    aviso("o painel de voz não respondeu.")
    PENDENCIAS.append("Voz: cole a mesma linha do manual de novo (o que já está pronto fica)")
    return False


def criar_atalho(area_de_trabalho):
    pasta = pathlib.Path(area_de_trabalho) if area_de_trabalho else CASA / "Desktop"
    if not pasta.is_dir():
        aviso("não achei a Área de Trabalho; o atalho Abrir Frank ficou de fora.")
        return
    url = f"http://127.0.0.1:{PAINEL_PORTA}/"
    if NO_MAC:
        atalho = pasta / "Abrir Frank.command"
        atalho.write_text(
            "#!/bin/bash\n"
            f"launchctl kickstart gui/$(id -u)/{ROTULO_PAINEL} >/dev/null 2>&1\n"
            f"for i in $(seq 1 20); do curl -fsS --max-time 1 {url}api/saude >/dev/null 2>&1 && break; sleep 1; done\n"
            f"open {url}\n", encoding="utf-8")
        atalho.chmod(0o755)
    else:
        # chcp 65001 antes dos caminhos: nome de usuário com acento chega inteiro.
        atalho = pasta / "Abrir Frank.cmd"
        atalho.write_text(
            "@echo off\r\nchcp 65001 >nul\r\n"
            f"curl -fsS --max-time 2 {url}api/saude >nul 2>&1 || (start \"\" wscript \"{PAINEL_DADOS / 'ligar-painel.vbs'}\" "
            "& timeout /t 6 /nobreak >nul)\r\n"
            f"start \"\" {url}\r\n", encoding="utf-8")
    ok(f"atalho na Área de Trabalho: {atalho.name}")


# ---------- serviço do Frank ----------
def ligar_gateway():
    if os.environ.get("TDF_SEM_SERVICO_HERMES") == "1":
        aviso("serviço do Frank não instalado (modo de teste).")
        return
    r, _ = hermes("gateway", "install", "--force", "--start-now", "--start-on-login", timeout=300)
    if r != 0:
        aviso("não consegui deixar o Frank ligando sozinho com o computador.")
        PENDENCIAS.append("Frank ligado: cole a mesma linha do manual de novo")
        return
    for _ in range(20):
        retorno, saida = hermes("gateway", "status", timeout=60)
        sinais = ("Gateway is running", "Gateway process running (PID:", "Gateway is supervised by launchd (PID ")
        if retorno == 0 and any(sinal in saida for sinal in sinais):
            ok("Frank ligado; volta sozinho quando você liga o computador")
            return
        time.sleep(3)
    aviso("o serviço do Frank foi instalado, mas não confirmou que está rodando.")
    PENDENCIAS.append("Frank ligado: reinicie o computador; se o Frank não responder, cole a linha do manual de novo")


MENSAGEM_ENVIADA = False


def avisar_no_telegram():
    global MENSAGEM_ENVIADA
    if not (R["TELEGRAM_BOT_TOKEN"] and R["TELEGRAM_ALLOWED_USERS"]):
        return
    if RESPOSTA_DO_FRANK:
        texto = (f"Oi, {R['NOME_DO_DONO']}! Aqui é o Frank, agora no seu computador. A instalação do seu time terminou. "
                 "Antes do primeiro pedido, quero conhecer a sua empresa: são umas perguntas rápidas, uma de cada vez. "
                 "Me responde um oi quando puder começar.")
    else:
        texto = (f"Oi, {R['NOME_DO_DONO']}! Aqui é o Frank. O Telegram está ligado, mas eu ainda estou sem cérebro para "
                 "responder. Volte ao manual, confira o passo 4 e cole a linha de novo.")
    if tg("sendMessage", chat_id=R["TELEGRAM_ALLOWED_USERS"], text=texto).get("ok"):
        MENSAGEM_ENVIADA = True
        ok("o Frank mandou uma mensagem para você no Telegram")
    else:
        aviso("não consegui mandar mensagem no Telegram agora. Mande um oi para o bot e veja se ele responde.")


def resumo_final(voz_ok):
    c = dados_do_cerebro(R["CEREBRO"])
    falta = list(PENDENCIAS)
    if R["TELEGRAM_BOT_TOKEN"] and not MENSAGEM_ENVIADA:
        falta.append("Telegram: mande um oi para o bot; se ele não responder, cole a linha do manual de novo")
    nome = R["NOME_DO_DONO"]
    if not falta:
        print(f"\n\033[1;32mPronto, {nome}! O seu time está instalado neste computador e o Frank já respondeu.\033[0m\n")
    else:
        print(f"\n\033[1;32mInstalado, {nome}.\033[0m Falta pouco:")
        for item in dict.fromkeys(falta):
            print(f"  - {item}")
        print()
    print(f"  Falar com o Frank:   {'https://t.me/' + BOT_USUARIO if BOT_USUARIO and R['TELEGRAM_BOT_TOKEN'] else 'Telegram desligado'}")
    print(f"  Cérebro:             {c['nome']}{' (testado: respondeu)' if RESPOSTA_DO_FRANK else ''}")
    if c["acesso"] != "nenhum":
        print(f"  Modelo e esforço:    {nome_do_modelo()}, esforço {nome_do_esforco()}")
    print(f"  Voz:                 {'dois cliques em Abrir Frank, na Área de Trabalho' if voz_ok else 'desligada'}")
    print("  Importante:          o Frank só responde com o computador ligado e acordado.")
    print("  Trocar algo:         no manual, ajuste a resposta, copie a linha de novo e cole aqui.")
    print(f"  Registro:            {LOG}\n")
    if MENSAGEM_ENVIADA and RESPOSTA_DO_FRANK:
        print("  O Frank já te mandou uma mensagem no Telegram. Responda com um oi.\n")


# ====================================================================
def principal():
    global HERMES, GUARDADO
    p = argparse.ArgumentParser()
    p.add_argument("--hermes", required=True)
    p.add_argument("--respostas", default=os.environ.pop("TDF_RESPOSTAS", ""))
    p.add_argument("--area-de-trabalho", default="")
    p.add_argument("--pacote", default="")
    args = p.parse_args()
    HERMES = args.hermes
    PASTA.mkdir(parents=True, exist_ok=True)
    registrar(f"Instalador local {VERSAO} em {time.strftime('%Y-%m-%dT%H:%M:%S')} ({SISTEMA})")
    if RESPOSTAS_GUARDADAS.exists():
        try:
            GUARDADO = json.loads(RESPOSTAS_GUARDADAS.read_text(encoding="utf-8"))
        except Exception:
            GUARDADO = {}

    passo("Conferindo este computador")
    _, versao = hermes("--version", timeout=60)
    ok(f"{SISTEMA} {platform.machine()}; {(versao.strip().splitlines() or ['Hermes'])[0]}")
    if not (args.respostas and aplicar_codigo(args.respostas)) and not pedir_codigo():
        falha("sem o código do manual não consigo instalar. No manual, faça os passos 2 a 5 e copie a linha da aba do seu computador.")
    R["NOME_DO_DONO"] = R["NOME_DO_DONO"] or "o dono"
    R["NOME_DA_EMPRESA"] = R["NOME_DA_EMPRESA"] or "a empresa"
    for chave, padrao in (("O_QUE_A_EMPRESA_VENDE", "ainda não informado; pergunte ao dono antes de escrever qualquer texto de venda"),
                          ("PUBLICO", "ainda não informado; pergunte ao dono antes de escrever qualquer texto de venda"),
                          ("TOM_DE_VOZ", "próximo, direto e respeitoso, sem gíria e sem exagero"),
                          ("PALAVRAS_PROIBIDAS", "nenhuma definida pelo dono até agora")):
        R[chave] = R[chave] or padrao
    ok(f"respostas do manual: {R['NOME_DA_EMPRESA']}, de {R['NOME_DO_DONO']}")
    conferir_telegram()
    conferir_cerebro()
    if R["GEMINI_API_KEY"]:
        ok("chave da voz recebida")
    print("\n    \033[1mAgora é comigo.\033[0m Leva de 10 a 20 minutos. Deixe esta janela aberta;"
          " se eu precisar de você, aviso com um bipe.")

    passo("Baixando o Frank, os 7 assistentes e o painel de voz")
    baixar_pacote(args.pacote)
    instalar_extras()

    passo(f"Instalando os 8 agentes com os dados de {R['NOME_DA_EMPRESA']}")
    instalar_agentes()
    aplicar_cerebro()
    gravar_telegram()
    instalar_comando_de_aviso()

    passo("Ligando o quadro de tarefas e as rotinas")
    r, _ = hermes("kanban", "init")
    if r != 0:
        falha("não consegui criar o quadro de tarefas. Cole a linha de novo.")
    criar_rotinas()

    passo("Ligando o painel de voz")
    ligar_api_do_hermes()
    RESPOSTAS_GUARDADAS.write_text(json.dumps(GUARDADO), encoding="utf-8")
    if not NO_WINDOWS:
        os.chmod(RESPOSTAS_GUARDADAS, 0o600)
    voz_ok = False
    if R["GEMINI_API_KEY"]:
        voz_ok = instalar_painel()
        if voz_ok:
            criar_atalho(args.area_de_trabalho)
    else:
        aviso("sem a chave da voz, o painel fica desligado.")
        PENDENCIAS.append("Voz: no passo 5 do manual, crie a chave, copie a linha de novo e cole aqui")

    passo("Ligando e testando o cérebro")
    ligar_cerebro()

    passo("Deixando o Frank ligado")
    ligar_gateway()

    passo("Conferindo")
    _, lista = hermes("profile", "list", timeout=120)
    n = sum(1 for a in AGENTES if re.search(rf"\b{a}\b", lista))
    if n == len(AGENTES):
        ok(f"{n} agentes instalados: {' '.join(AGENTES)}")
    else:
        falha(f"encontrei {n} de {len(AGENTES)} agentes. Cole a linha de novo.")
    avisar_no_telegram()
    resumo_final(voz_ok)


if __name__ == "__main__":
    try:
        principal()
    except Parou as erro:
        print(f"\n\033[1;31mParou: {erro}\033[0m", file=sys.stderr)
        print(f"Registro completo em {LOG}. Mostre a tela ao Vitor, no canto do manual.", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n\033[1;31mParou: você interrompeu a instalação. Cole a linha de novo para continuar.\033[0m", file=sys.stderr)
        sys.exit(130)
