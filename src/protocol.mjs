const MAX_QUESTIONS = 3
const MAX_OPTIONS = 8

function fail(message) {
  throw new TypeError(message)
}

function text(value, field, max) {
  if (typeof value !== 'string') fail(`${field} 必须是文字。`)
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > max) fail(`${field} 长度无效。`)
  return normalized
}

/** Normalize model arguments before the immediate, non-blocking acknowledgement. */
export function normalizeQuestions(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('提问参数必须是对象。')
  const source = value.questions
  if (!Array.isArray(source) || source.length === 0 || source.length > MAX_QUESTIONS) {
    fail(`每次可提出 1 到 ${MAX_QUESTIONS} 个非阻塞问题。`)
  }
  const ids = new Set()
  return source.map((candidate, index) => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) fail(`第 ${index + 1} 个问题无效。`)
    const item = candidate
    const id = text(item.id, `第 ${index + 1} 个问题 id`, 96)
    if (ids.has(id)) fail('同一次调用的问题 id 不能重复。')
    ids.add(id)
    const question = text(item.question, `第 ${index + 1} 个问题`, 1200)
    const header = item.header === undefined ? undefined : text(item.header, `第 ${index + 1} 个问题标题`, 120)
    let options
    if (item.options !== undefined) {
      if (!Array.isArray(item.options) || item.options.length === 0 || item.options.length > MAX_OPTIONS) {
        fail(`第 ${index + 1} 个问题的选项数量无效。`)
      }
      const labels = new Set()
      options = item.options.map((option, optionIndex) => {
        if (option === null || typeof option !== 'object' || Array.isArray(option)) fail(`第 ${index + 1} 个问题的第 ${optionIndex + 1} 个选项无效。`)
        const label = text(option.label, `第 ${index + 1} 个问题的选项标签`, 120)
        if (labels.has(label)) fail(`第 ${index + 1} 个问题的选项不能重复。`)
        labels.add(label)
        return {
          label,
          ...(option.description === undefined ? {} : { description: text(option.description, `第 ${index + 1} 个问题的选项说明`, 360) }),
        }
      })
    }
    if (item.multi_select !== undefined && typeof item.multi_select !== 'boolean') fail(`第 ${index + 1} 个问题的 multi_select 必须是布尔值。`)
    return {
      id,
      question,
      ...(header === undefined ? {} : { header }),
      ...(options === undefined ? {} : { options }),
      ...(item.multi_select === true ? { multiSelect: true } : {}),
    }
  })
}

export function queuedResult(questions) {
  return {
    status: 'queued',
    questionIds: questions.map(question => question.id),
    continuation: 'The question was shown without waiting. Continue independently and treat silence as no answer.',
  }
}
