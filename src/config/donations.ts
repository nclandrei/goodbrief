// Donation/support links configuration
// Update these with your personal links

export const donations = {
  // Ko-fi - for international supporters (0% platform fee, ~2.9% payment processing)
  // Get your link at: https://ko-fi.com
  kofi: {
    url: 'https://ko-fi.com/goodbrief',
    enabled: true,
  },

  // Revolut - for Romanian supporters (0% fee for Revolut-to-Revolut)
  // Get your Revolut.me link in the Revolut app: Profile > Revolut.me
  revolut: {
    url: 'https://revolut.me/nclandrei',
    enabled: true,
  },
} as const;

export type DonationPlatform = keyof typeof donations;
