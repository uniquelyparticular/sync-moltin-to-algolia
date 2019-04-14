const { json, send } = require('micro')
const algoliasearch = require('algoliasearch')

const algolia = algoliasearch(
  process.env.ALGOLIA_APP_ID,
  process.env.ALGOLIA_API_KEY
)

const cors = require('micro-cors')({
  allowMethods: ['POST'],
  exposeHeaders: ['x-moltin-secret-key'],
  allowHeaders: [
    'x-moltin-secret-key',
    'x-forwarded-proto',
    'X-Requested-With',
    'Access-Control-Allow-Origin',
    'X-HTTP-Method-Override',
    'Content-Type',
    'Authorization',
    'Accept'
  ]
})

const _toJSON = error => {
  return !error
    ? ''
    : Object.getOwnPropertyNames(error).reduce(
        (jsonError, key) => {
          return { ...jsonError, [key]: error[key] }
        },
        { type: 'error' }
      )
}

const _toCamelcase = string => {
  return !string
    ? ''
    : string.replace(
        /\w\S*/g,
        word => `${word.charAt(0).toUpperCase()}${word.substr(1).toLowerCase()}`
      )
}

process.on('unhandledRejection', (reason, p) => {
  console.error(
    'Promise unhandledRejection: ',
    p,
    ', reason:',
    JSON.stringify(reason)
  )
})

module.exports = cors(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return send(res, 204)
  }
  if (
    (await req.headers['x-moltin-secret-key']) !=
    process.env.MOLTIN_WEBHOOK_SECRET
  )
    return send(res, 401)

  try {
    const { triggered_by, resources } = await json(req)

    const {
      data: { type: observable, id: observable_id }
    } = JSON.parse(resources)

    const [type, trigger] = triggered_by.split('.') //type is 'order', trigger is `created`,`updated`,`fulfilled` or `paid`
    // console.log('type', type)
    // console.log('observable', observable)
    // console.log('observable_id', observable_id)

    const indexedEntities = process.env.MOLTIN_AGOLIA_INDICES
      ? process.env.MOLTIN_AGOLIA_INDICES.split(',')
      : [
          'products',
          'brands',
          'categories',
          'collections',
          'orders',
          'customers'
        ]

    if (observable === type && indexedEntities.includes(type)) {
      //should always be the case, but to double check for security

      const index = algolia.initIndex(type)
      let body

      if (trigger === 'deleted') {
        body = await index.deleteObject(resources.id)
        return send(res, 200, body)
      }

      const object = { observable_id, ...rest }

      if (trigger === 'created') {
        body = await index.addObject(object)
      } else if (trigger === 'updated') {
        body = await index.saveObject(object)
      } else {
        throw new Error(`'${trigger}' is not a valid trigger`)
      }

      send(res, 200, body)
    } else {
      console.error(
        `observable[${observable}] does not equal type[${type}] or not in indexedEntities`
      )
      return send(
        res,
        500,
        JSON.stringify({
          received: true,
          errorMessage: `observable[${observable}] does not equal type[${type}]`
        })
      )
    }
  } catch (error) {
    const jsonError = _toJSON(error)
    return send(res, 500, jsonError)
  }
})
