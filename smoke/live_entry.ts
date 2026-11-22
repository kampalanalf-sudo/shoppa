// Convenience re-export so the payment surface can be SSR-built in one pass.
// All three now live behind the api/pay.ts router.
export { default as pay } from '../api/pay'
export { default as webhook } from '../api/webhooks/dgateway'
