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

/*
{
  id: "3f220293-dd81-44a9-8701-f7dac8236141",
  triggered_by: "product.updated",
  attempt: 1,
  integration: {
    id: "080f46d8-1618-4b32-b48e-688e9349584a",
    integration_type: "webhook",
    name: "DEVELOPMENT: products to algolia"
  },
  resources: "{"data":{"type":"product","id":"8cad063b-7451-4bed-86b4-9d3b8a3f19c3","name":"#GOALS CREW","slug":"9010709627","sku":"190107096270","manage_stock":false,"description":"#GOALS CREW","price":[{"amount":1600,"currency":"USD","includes_tax":true}],"status":"live","commodity_type":"physical","meta":{"timestamps":{"created_at":"2018-05-31T09:38:28+00:00","updated_at":"2019-04-14T22:33:27+00:00"},"display_price":{"with_tax":{"amount":1600,"currency":"USD","formatted":"$16.00"},"without_tax":{"amount":1600,"currency":"USD","formatted":"$16.00"}},"stock":{"level":0,"availability":"out-stock"},"variation_matrix":[]},"relationships":{},"style":"W557C17#GO","color":"COR","size":"S"}}"
}
/*/

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
      data: { type: observable, id: observable_id, ...rest }
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

    // console.log('indexedEntities',indexedEntities)

    if (observable === type && indexedEntities.includes(`${type}s`)) {
      //should always be the case, but to double check for security

      const index = algolia.initIndex(type)
      let body

      if (trigger === 'deleted') {
        body = await index.deleteObject(resources.id)
        return send(res, 200, body)
      }

      const object = { objectID: observable_id, ...rest }

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
