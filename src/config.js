// Everything brand-related lives here so the look stays consistent.
module.exports = {
  brand: { name: 'Mochi', emoji: '🍡' },
  defaultPrefix: '.',
  owners: (process.env.OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  links: {
    support: process.env.SUPPORT_URL || '',
    vote: process.env.VOTE_URL || '',
    reportChannel: process.env.REPORT_CHANNEL_ID || '',
  },
  // Pastel palette. Each area of the bot has its own bar colour; errors are always cherry.
  colors: {
    strawberry: 0xffb7d5, // brand, general info
    matcha: 0xa8e6cf,     // success
    lavender: 0xcdb4f6,   // moderation, system
    butter: 0xfff1a8,     // warnings
    peach: 0xffd3b6,      // giveaways, social
    sky: 0xaed9f7,        // tickets, utility
    cherry: 0xff9aa2,     // errors, destructive
    mint: 0xc7f0db,       // logs
  },
};
