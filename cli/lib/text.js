// C1 must not match inside C12, ABC1, C1b or #C1C1C1, but may follow a lowercase word, as in a
// Go test name (TestC1_LateRefund).
export function mentionsId(text, id) {
  return new RegExp(`(?<![0-9A-Z])${id}(?![0-9A-Za-z])`).test(text)
}

export function splitRequest(text) {
  return text
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((sentence, index) => ({ id: `S${index + 1}`, text: sentence }))
}
