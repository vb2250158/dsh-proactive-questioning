/** Serialize one answer as durable user text, retaining the original option values. */
export function answerText(entry, selected, custom) {
  return [
    `对非阻塞问题「${entry.question.question}」的回答：`,
    JSON.stringify({ questionId: `${entry.callId}:${entry.question.id}`, selected, ...(custom === '' ? {} : { custom }) }),
    '请把它作为后续建议或决策的输入；之前的工作不需要重做。',
  ].join('\n')
}

/** Recognize only a complete answer envelope; malformed or unrelated text stays visible verbatim. */
export function parseAnswerText(text) {
  const suffix = '\n请把它作为后续建议或决策的输入；之前的工作不需要重做。'
  const prefix = '对非阻塞问题「'
  const separator = '」的回答：\n'
  if (!text.startsWith(prefix) || !text.endsWith(suffix)) return undefined
  const split = text.lastIndexOf(separator, text.length - suffix.length)
  if (split < prefix.length) return undefined
  const question = text.slice(prefix.length, split)
  if (question.trim() === '') return undefined
  try {
    const value = JSON.parse(text.slice(split + separator.length, -suffix.length))
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || typeof value.questionId !== 'string' || value.questionId.trim() === ''
      || !Array.isArray(value.selected) || !value.selected.every(item => typeof item === 'string')
      || (value.custom !== undefined && typeof value.custom !== 'string')
      || Object.keys(value).some(key => !['questionId', 'selected', 'custom'].includes(key))
      || (value.selected.length === 0 && (value.custom ?? '').trim() === '')) return undefined
    return { question, selected: value.selected, custom: value.custom ?? '' }
  } catch (error) {
    // Unrecognized stored messages retain their original text.
    return undefined
  }
}
