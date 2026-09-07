// Original, deliberately small word lists: suggestions are editable labels,
// never workspace identities or security credentials.
const adjectives = ['Curious', 'Sleepy', 'Dancing', 'Wobbly', 'Cosmic', 'Sneaky', 'Jolly', 'Bouncy', 'Fearless', 'Dreamy', 'Sparkly', 'Nimble', 'Fuzzy', 'Mighty', 'Cheeky', 'Lucky']
const nouns = ['Otter', 'Comet', 'Panda', 'Wombat', 'Badger', 'Noodle', 'Penguin', 'Meteor', 'Gecko', 'Teapot', 'Mango', 'Walrus', 'Jellybean', 'Cactus', 'Moonbeam', 'Capybara']

export function suggestWorkspaceName(existingNames: Iterable<string>, random: () => number = Math.random): string {
  const occupied = new Set([...existingNames].map(name => name.trim().toLowerCase()))
  let candidate = ''
  for (let attempt = 0; attempt < 8; attempt += 1) {
    candidate = `${adjectives[Math.floor(random() * adjectives.length)]!} ${nouns[Math.floor(random() * nouns.length)]!}`
    if (!occupied.has(candidate.toLowerCase())) return candidate
  }
  // A repeated random choice or exhausted word-pair pool must still finish.
  // At most occupied.size + 1 suffixes can be blocked by this finite set.
  let suffix = 2
  while (occupied.has(`${candidate} ${suffix}`.toLowerCase())) suffix += 1
  return `${candidate} ${suffix}`
}
