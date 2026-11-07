// Modelos e vozes dos motores de voz. Sem segredos: as chaves ficam no .env.
// FRANK_VOZ escolhe a voz padrão do Gemini Live entre as desta lista.
export default {
  geminiLive: {
    modelo: 'gemini-3.8-live',
    vozPadrao: 'Puck',
    vozes: [
      { id: 'Puck', nome: 'Puck · animado' },
      { id: 'Achird', nome: 'Achird · amigável' },
      { id: 'Umbriel', nome: 'Umbriel · tranquilo' },
      { id: 'Zubenelgenubi', nome: 'Zubenelgenubi · casual' },
      { id: 'Sadachbia', nome: 'Sadachbia · vivo' },
      { id: 'Charon', nome: 'Charon · informativo' },
      { id: 'Orus', nome: 'Orus · firme' },
    ],
  },
  gptLive: {
    modelo: 'gpt-live-1',
    vozPadrao: 'tempo',
    vozes: ['tempo', 'stone', 'bossa', 'marin', 'cedar'],
  },
};
