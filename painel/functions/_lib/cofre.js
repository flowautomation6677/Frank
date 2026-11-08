/**
 * ==============================================================================
 * Flow Automation · Enterprise Secrets Vault (Cofre Centralizado de Segredos)
 * ==============================================================================
 * Armazenamento criptografado (AES-256-GCM com KDF PBKDF2) e injeção em memória
 * em tempo de execução para APIs de terceiros (Google Gemini Live, OpenAI, Telegram, Hermes).
 * 
 * Precedência de Resolução:
 *   1. process.env / env da requisição (maior prioridade - Docker/Nuvem/CI)
 *   2. Cofre Criptografado em disco (AES-256-GCM)
 *   3. Arquivo .env local
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ALGORITMO_CIFRA = 'aes-256-gcm';
const DIGEST_KDF = 'sha256';
const ITERACOES_KDF = 100_000;
const TAMANHO_CHAVE_BYTES = 32; // 256 bits
const TAMANHO_IV_BYTES = 12; // 96 bits para GCM
const TAMANHO_SALT_BYTES = 16;

export const NOMES_SEGREDO_PADRAO = [
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'HERMES_API_KEY',
  'FRANK_ACCESS_CODE',
  'OPENROUTER_API_KEY',
];

// Caminho padrão do cofre cifrado
export function resolverCaminhoCofre(env = process.env) {
  if (env.FRANK_VAULT_PATH) return env.FRANK_VAULT_PATH;

  if (env.FRANK_PASTA_DE_DADOS) {
    return path.join(env.FRANK_PASTA_DE_DADOS, 'frank.vault.json');
  }

  const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'TimeDoFrank', 'dados', 'frank.vault.json');
}

// Caminho do arquivo da chave mestra do cofre
export function resolverCaminhoChaveMestra(caminhoCofre) {
  const pasta = path.dirname(caminhoCofre);
  return path.join(pasta, '.vault.key');
}

/**
 * Deriva uma chave de 256 bits a partir de uma senha mestra e salt via PBKDF2.
 */
export function derivarChave(senhaMestra, salt) {
  return crypto.pbkdf2Sync(senhaMestra, salt, ITERACOES_KDF, TAMANHO_CHAVE_BYTES, DIGEST_KDF);
}

/**
 * Cifra um objeto ou texto usando AES-256-GCM autenticado.
 */
export function cifrarDados(dados, senhaMestra) {
  const texto = typeof dados === 'string' ? dados : JSON.stringify(dados);
  const salt = crypto.randomBytes(TAMANHO_SALT_BYTES);
  const chave = derivarChave(senhaMestra, salt);
  const iv = crypto.randomBytes(TAMANHO_IV_BYTES);

  const cipher = crypto.createCipheriv(ALGORITMO_CIFRA, chave, iv);
  let dadosCifrados = cipher.update(texto, 'utf-8', 'hex');
  dadosCifrados += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return {
    versao: '1.0',
    kdf: {
      algoritmo: 'pbkdf2',
      digest: DIGEST_KDF,
      iteracoes: ITERACOES_KDF,
      salt: salt.toString('hex'),
    },
    cifra: {
      algoritmo: ALGORITMO_CIFRA,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      dadosCifrados,
    },
    atualizadoEm: new Date().toISOString(),
  };
}

/**
 * Decifra o payload AES-256-GCM validando a autenticidade e integridade criptográfica.
 */
export function decifrarDados(payloadCifrado, senhaMestra) {
  if (!payloadCifrado?.cifra || !payloadCifrado?.kdf) {
    throw new Error('Payload do cofre inválido ou corrompido.');
  }

  const salt = Buffer.from(payloadCifrado.kdf.salt, 'hex');
  const iv = Buffer.from(payloadCifrado.cifra.iv, 'hex');
  const authTag = Buffer.from(payloadCifrado.cifra.authTag, 'hex');
  const chave = derivarChave(senhaMestra, salt);

  const decipher = crypto.createDecipheriv(ALGORITMO_CIFRA, chave, iv);
  decipher.setAuthTag(authTag);

  let textoDecifrado = decipher.update(payloadCifrado.cifra.dadosCifrados, 'hex', 'utf-8');
  textoDecifrado += decipher.final('utf-8');

  try {
    return JSON.parse(textoDecifrado);
  } catch {
    return textoDecifrado;
  }
}

/**
 * Mascara qualquer chave ou token para exibição segura sem vazamento.
 */
export function mascararChave(valor) {
  if (!valor || typeof valor !== 'string' || valor.trim() === '') {
    return '(não configurada)';
  }
  const limpo = valor.trim();
  if (limpo.length <= 8) return '****';

  if (limpo.startsWith('sk-')) {
    return `sk-****...${limpo.slice(-4)}`;
  }
  if (limpo.startsWith('AIzaSy')) {
    return `AIzaSy****...${limpo.slice(-4)}`;
  }
  return `${limpo.slice(0, 4)}****${limpo.slice(-4)}`;
}

/**
 * Classe controladora do Cofre de Segredos.
 */
export class CofreDeSegredos {
  constructor({ caminhoCofre = null, senhaMestra = null, env = process.env } = {}) {
    this.env = env;
    this.caminhoCofre = caminhoCofre || resolverCaminhoCofre(env);
    this.caminhoChaveMestra = resolverCaminhoChaveMestra(this.caminhoCofre);
    this.senhaMestra = senhaMestra || this._obterOuCriarSenhaMestra();
    this.segredosEmMemoria = null;
  }

  _obterOuCriarSenhaMestra() {
    if (this.env.FRANK_VAULT_KEY) {
      return this.env.FRANK_VAULT_KEY;
    }

    if (fs.existsSync(this.caminhoChaveMestra)) {
      return fs.readFileSync(this.caminhoChaveMestra, 'utf-8').trim();
    }

    // Gera nova chave mestra aleatória de 32 bytes (256 bits)
    const pastaPai = path.dirname(this.caminhoChaveMestra);
    if (!fs.existsSync(pastaPai)) {
      fs.mkdirSync(pastaPai, { recursive: true });
    }

    const novaSenha = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(this.caminhoChaveMestra, novaSenha, { encoding: 'utf-8', mode: 0o600 });
    return novaSenha;
  }

  carregarSegredos() {
    if (this.segredosEmMemoria !== null) {
      return this.segredosEmMemoria;
    }

    if (!fs.existsSync(this.caminhoCofre)) {
      this.segredosEmMemoria = {};
      return this.segredosEmMemoria;
    }

    try {
      const conteudo = JSON.parse(fs.readFileSync(this.caminhoCofre, 'utf-8'));
      const dados = decifrarDados(conteudo, this.senhaMestra);
      this.segredosEmMemoria = typeof dados === 'object' && dados !== null ? dados : {};
      return this.segredosEmMemoria;
    } catch (erro) {
      console.warn(`[cofre] Aviso: Não foi possível decifrar o cofre (${erro.message}). Iniciando vazio.`);
      this.segredosEmMemoria = {};
      return this.segredosEmMemoria;
    }
  }

  salvarSegredos() {
    const pastaPai = path.dirname(this.caminhoCofre);
    if (!fs.existsSync(pastaPai)) {
      fs.mkdirSync(pastaPai, { recursive: true });
    }

    const payload = cifrarDados(this.segredosEmMemoria || {}, this.senhaMestra);
    fs.writeFileSync(this.caminhoCofre, JSON.stringify(payload, null, 2), { encoding: 'utf-8', mode: 0o600 });
  }

  obter(nome, envContexto = null) {
    if (!nome) return null;

    // 1. Precedência: Ambiente do processo / env injetado
    const valorEnv = envContexto?.[nome] ?? this.env?.[nome] ?? process.env[nome];
    if (valorEnv && typeof valorEnv === 'string' && valorEnv.trim() !== '' && !valorEnv.startsWith('vault:')) {
      return valorEnv.trim();
    }

    // 2. Precedência: Cofre Criptografado
    const segredos = this.carregarSegredos();
    if (segredos[nome] && typeof segredos[nome] === 'string' && segredos[nome].trim() !== '') {
      return segredos[nome].trim();
    }

    return null;
  }

  definir(nome, valor) {
    if (!nome || typeof nome !== 'string') {
      throw new Error('Nome do segredo precisa ser texto.');
    }
    const nomeLimpo = nome.trim().toUpperCase();
    const segredos = this.carregarSegredos();
    segredos[nomeLimpo] = valor ? String(valor).trim() : '';
    this.salvarSegredos();
    return true;
  }

  remover(nome) {
    const nomeLimpo = nome.trim().toUpperCase();
    const segredos = this.carregarSegredos();
    if (Object.hasOwn(segredos, nomeLimpo)) {
      delete segredos[nomeLimpo];
      this.salvarSegredos();
      return true;
    }
    return false;
  }

  listarMascarado(envContexto = null) {
    const todosNomes = new Set([...NOMES_SEGREDO_PADRAO, ...Object.keys(this.carregarSegredos())]);
    const lista = [];

    for (const nome of todosNomes) {
      const valor = this.obter(nome, envContexto);
      const doEnv = Boolean((envContexto?.[nome] || this.env?.[nome] || process.env[nome]) && !((envContexto?.[nome] || this.env?.[nome] || process.env[nome]).startsWith('vault:')));
      const doCofre = Boolean(this.carregarSegredos()[nome]);

      let origem = 'ausente';
      if (doEnv && doCofre) origem = 'ambiente (sobrescrevendo cofre)';
      else if (doEnv) origem = 'variável de ambiente';
      else if (doCofre) origem = 'cofre criptografado';

      lista.push({
        chave: nome,
        configurado: Boolean(valor),
        origem,
        valorMascarado: mascararChave(valor),
      });
    }

    return lista;
  }

  injetarNoAmbiente(envAlvo = process.env) {
    const segredos = this.carregarSegredos();
    for (const [chave, valor] of Object.entries(segredos)) {
      if (!envAlvo[chave] || envAlvo[chave].startsWith('vault:')) {
        envAlvo[chave] = valor;
      }
    }
    return envAlvo;
  }
}

// Instância Singleton do Cofre para uso compartilhado
let cofrePadrao = null;

export function obterCofre(opcoes = {}) {
  if (!cofrePadrao || opcoes.forcarNovo) {
    cofrePadrao = new CofreDeSegredos(opcoes);
  }
  return cofrePadrao;
}

export function obterSegredo(nome, env = null) {
  const cofre = obterCofre();
  return cofre.obter(nome, env);
}
