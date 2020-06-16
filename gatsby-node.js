/**
 * Implement Gatsby's Node APIs in this file.
 *
 * See: https://www.gatsbyjs.org/docs/node-apis/
 */
const fs = require("fs-extra")
const fetch = require("node-fetch")
const path = require("path")
const { parse, print, Source, buildASTSchema } = require("graphql")
const {
  sourceNodes,
} = require("./plugins/gatsby-graphql-toolkit/dist/steps/sourcing/source-nodes")
const {
  createSchemaCustomization,
} = require("./plugins/gatsby-graphql-toolkit/dist/steps/create-schema-customization/create-schema-customization")
const {
  generateDefaultUserFragments,
} = require("./plugins/gatsby-graphql-toolkit/dist/steps/ingest-remote-schema/generate-default-user-fragments")
const {
  buildNodeDefinitions,
} = require("./plugins/gatsby-graphql-toolkit/dist/steps/ingest-remote-schema/build-node-definitions")

const craftGqlToken = process.env.CRAFTGQL_TOKEN
const craftGqlUrl = process.env.CRAFTGQL_URL
const fragmentsDir = __dirname + "/src/craft-fragments"
const debugDir = __dirname + "/.cache/craft-graphql-documents"
const gatsbyTypePrefix = `Craft_`

let schema
let gatsbyNodeTypes
let sourcingConfig

// 1. Gatsby field aliases
// 2. Node ID transforms?
// 3. Pagination strategies?
// 4. Schema customization field transforms?
// 5. Query variable provider?

async function getSchema() {
  if (!schema) {
    schema = buildASTSchema(
      parse(fs.readFileSync(__dirname + "/schema.graphql").toString())
    )
  }
  return schema
}

async function getGatsbyNodeTypes() {
  if (gatsbyNodeTypes) {
    return gatsbyNodeTypes
  }
  const schema = await getSchema()
  const fromIface = (ifaceName, doc) => {
    const iface = schema.getType(ifaceName)
    return schema.getPossibleTypes(iface).map(type => ({
      remoteTypeName: type.name,
      remoteIdFields: [`__typename`, `id`],
      queries: doc(type.name),
    }))
  }
  // prettier-ignore
  return (gatsbyNodeTypes = [
    ...fromIface(`EntryInterface`, type => `
      query ALL_${type} { entries(type: "${type.split(`_`)[0]}", limit: $limit, offset: $offset) }
      query ONE_${type} { entry(type: "${type.split(`_`)[0]}", id: $id, limit: $limit, offset: $offset) }
    `),
    ...fromIface(`AssetInterface`, type => `
      query ALL_${type} { assets(limit: $limit, offset: $offset) }
    `),
    ...fromIface(`UserInterface`, type => `
      query ALL_${type} { users(limit: $limit, offset: $offset) }
    `),
    ...fromIface(`TagInterface`, type => `
      query ALL_${type} { tags(limit: $limit, offset: $offset) }
    `),
    ...fromIface(`GlobalSetInterface`, type => `
      query ALL_${type} { globalSets(limit: $limit, offset: $offset) }
    `),
  ])
}

async function writeDefaultFragments() {
  const defaultFragments = generateDefaultUserFragments({
    schema: await getSchema(),
    gatsbyNodeTypes: await getGatsbyNodeTypes(),
  })
  for (const [remoteTypeName, fragment] of defaultFragments) {
    const filePath = path.join(fragmentsDir, `${remoteTypeName}.graphql`)
    if (!fs.existsSync(filePath)) {
      await fs.writeFile(filePath, fragment)
    }
  }
}

async function collectFragments() {
  const customFragments = []
  for (const fileName of await fs.readdir(fragmentsDir)) {
    if (/.graphql$/.test(fileName)) {
      const filePath = path.join(fragmentsDir, fileName)
      const fragment = await fs.readFile(filePath)
      customFragments.push(new Source(fragment.toString(), filePath))
    }
  }
  return customFragments
}

async function writeCompiledQueries(nodeDefs) {
  await fs.ensureDir(debugDir)
  for (const [, def] of nodeDefs) {
    await fs.writeFile(
      debugDir + `/${def.remoteTypeName}.graphql`,
      print(def.document)
    )
  }
}

async function getSourcingConfig(gatsbyApi, pluginOptions) {
  if (sourcingConfig) {
    return sourcingConfig
  }
  const schema = await getSchema()
  const gatsbyNodeDefs = buildNodeDefinitions({
    schema,
    gatsbyNodeTypes: await getGatsbyNodeTypes(),
    customFragments: await collectFragments(),
  })
  await writeCompiledQueries(gatsbyNodeDefs)

  return (sourcingConfig = {
    gatsbyApi,
    schema,
    gatsbyNodeDefs,
    gatsbyTypePrefix,
    execute: ({ operationName, query, variables = {} }) => {
      console.log(operationName, variables)
      return fetch(craftGqlUrl, {
        method: "POST",
        body: JSON.stringify({ query, variables, operationName }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${craftGqlToken}`,
        },
      }).then(res => res.json())
    },
  })
}

exports.onPreBootstrap = async (gatsbyApi, pluginOptions) => {
  await writeDefaultFragments()
}

exports.createSchemaCustomization = async (gatsbyApi, pluginOptions) => {
  const config = await getSourcingConfig(gatsbyApi, pluginOptions)
  await createSchemaCustomization(config)
}

exports.sourceNodes = async (gatsbyApi, pluginOptions) => {
  const config = await getSourcingConfig(gatsbyApi, pluginOptions)

  // fetch delta IDs
  const ids = [
    { remoteNodeType: `post`, remoteNodeId: 5 },
    { remoteNodeType: `post`, remoteNodeId: 6 },
    { remoteNodeType: `post`, remoteNodeId: 7 },
    { remoteNodeType: `post`, remoteNodeId: 8 },
  ]

  await sourceNodes(config)
}
