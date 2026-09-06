// The Web3 Discovery call asks three things before the time is confirmed. Read by /js/booking.js
// on every panel opened from a /blockchain page (the CTA modal and /blockchain/book alike).
window.rejigBookingDefaults = {
  questions: [
    { label: 'What are you building?', required: true, options: ['L1 / L2', 'DeFi', 'Exchange / CEX', 'Wallet', 'Infra / tooling', 'NFT / gaming', 'Other'] },
    { label: 'Stage', required: true, options: ['Pre-launch', 'Live, under 10k users', 'Live, 10k+ users'] },
    { label: 'Monthly marketing budget', required: true, options: ['Under $5k', '$5k – $20k', '$20k+'] },
    { label: 'Anything to add?', placeholder: 'Goals, timeline, links…' },
  ],
};
