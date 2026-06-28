// Replace these with your careerskills folder definitions
export const CAREERS = [
  {
    id: 'farmer', name: 'Farmer',
    tunicColor: 0x4a7c59, skinColor: 0xf4c88a, pantsColor: 0x8b6914, hatColor: 0xd4a853,
    produces: { grain: 3, vegetables: 2 }, needs: ['tools', 'bread'],
    workplace: 'fields', workStart: 6, workEnd: 18,
    idleAnim: 'hoeing', emoji: '🌾'
  },
  {
    id: 'blacksmith', name: 'Blacksmith',
    tunicColor: 0x333333, skinColor: 0xc87941, pantsColor: 0x4a3728, hatColor: null,
    produces: { tools: 2, nails: 4 }, needs: ['grain', 'wood', 'beer'],
    workplace: 'smithy', workStart: 7, workEnd: 17,
    idleAnim: 'hammering', emoji: '⚒️'
  },
  {
    id: 'baker', name: 'Baker',
    tunicColor: 0xf5f0e8, skinColor: 0xf4c88a, pantsColor: 0x8b7355, hatColor: 0xffffff,
    produces: { bread: 4, pastry: 2 }, needs: ['grain', 'wood'],
    workplace: 'bakery', workStart: 5, workEnd: 14,
    idleAnim: 'kneading', emoji: '🍞'
  },
  {
    id: 'merchant', name: 'Merchant',
    tunicColor: 0x7b2d8b, skinColor: 0xf4c88a, pantsColor: 0x3d1a5c, hatColor: 0x5a1f6e,
    produces: { coins: 2 }, needs: ['bread', 'tools', 'cloth'],
    workplace: 'market', workStart: 8, workEnd: 19,
    idleAnim: 'gesturing', emoji: '💰'
  },
  {
    id: 'woodcutter', name: 'Woodcutter',
    tunicColor: 0x6b4c2a, skinColor: 0xd4956a, pantsColor: 0x3d2b16, hatColor: 0x5a3e22,
    produces: { wood: 5, planks: 2 }, needs: ['bread', 'beer'],
    workplace: 'forest', workStart: 7, workEnd: 16,
    idleAnim: 'chopping', emoji: '🪓'
  },
  {
    id: 'fisher', name: 'Fisher',
    tunicColor: 0x2c6e9e, skinColor: 0xf4c88a, pantsColor: 0x1a4a6b, hatColor: 0x1a4a6b,
    produces: { fish: 4 }, needs: ['bread', 'tools'],
    workplace: 'dock', workStart: 5, workEnd: 15,
    idleAnim: 'fishing', emoji: '🎣'
  },
  {
    id: 'healer', name: 'Healer',
    tunicColor: 0xffffff, skinColor: 0xf4c88a, pantsColor: 0xd0d0d0, hatColor: 0xe8e8e8,
    produces: { medicine: 2, remedy: 1 }, needs: ['grain', 'vegetables', 'coins'],
    workplace: 'healers_hut', workStart: 8, workEnd: 20,
    idleAnim: 'mixing', emoji: '⚕️'
  },
  {
    id: 'hunter', name: 'Hunter',
    tunicColor: 0x5c4a2a, skinColor: 0xd4956a, pantsColor: 0x3d3020, hatColor: 0x4a3820,
    produces: { meat: 3, leather: 2 }, needs: ['bread', 'tools'],
    workplace: 'forest', workStart: 5, workEnd: 14,
    idleAnim: 'stalking', emoji: '🏹'
  },
  {
    id: 'shepherd', name: 'Shepherd',
    tunicColor: 0x9eb87a, skinColor: 0xf4c88a, pantsColor: 0x6b8a5a, hatColor: 0x7a9a6a,
    produces: { wool: 3, milk: 2 }, needs: ['grain', 'bread'],
    workplace: 'pasture', workStart: 6, workEnd: 17,
    idleAnim: 'walking', emoji: '🐑'
  },
  {
    id: 'innkeeper', name: 'Innkeeper',
    tunicColor: 0xaa3333, skinColor: 0xf4c88a, pantsColor: 0x6b2020, hatColor: null,
    produces: { beer: 4, meals: 3 }, needs: ['grain', 'vegetables', 'meat', 'wood'],
    workplace: 'tavern', workStart: 10, workEnd: 23,
    idleAnim: 'serving', emoji: '🍺'
  },
  {
    id: 'potter', name: 'Potter',
    tunicColor: 0xc47a3a, skinColor: 0xf4c88a, pantsColor: 0x8b5e2a, hatColor: null,
    produces: { pottery: 3, tiles: 2 }, needs: ['wood', 'grain', 'vegetables'],
    workplace: 'pottery', workStart: 8, workEnd: 17,
    idleAnim: 'spinning', emoji: '🏺'
  },
  {
    id: 'weaver', name: 'Weaver',
    tunicColor: 0xe8a0c8, skinColor: 0xf4c88a, pantsColor: 0xb06090, hatColor: 0xd080a0,
    produces: { cloth: 3, thread: 2 }, needs: ['wool', 'vegetables', 'bread'],
    workplace: 'weavery', workStart: 7, workEnd: 16,
    idleAnim: 'weaving', emoji: '🧵'
  }
];

export const CAREER_MAP = Object.fromEntries(CAREERS.map(c => [c.id, c]));

export const GOODS = [
  'grain','vegetables','tools','bread','nails','pastry','coins','wood','planks',
  'fish','medicine','remedy','meat','leather','wool','milk','beer','meals','pottery',
  'tiles','cloth','thread'
];
