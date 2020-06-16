import {
  IFetchResult,
  ISourcingContext,
  IRemoteNode,
  IGatsbyNodeDefinition,
} from "../../../types"
import {transformRemoteNode} from "./transform-remote-node";
import {NodeInput} from "gatsby";

export async function createNodes(
  context: ISourcingContext,
  result: IFetchResult
) {
    // FIXME:
    const def = context.gatsbyNodeDefs.get(result.remoteTypeName)
    if (!def) {
      throw new Error(`${result.remoteTypeName} is not a Gatsby node type`)
    }
    for (const node of result.allNodes) {
      await createNode(context, def, node)
    }
}

export async function createNode(
  context: ISourcingContext,
  def: IGatsbyNodeDefinition,
  remoteNode: IRemoteNode
) {
  const {
    gatsbyApi: { actions, createContentDigest },
  } = context

  // TODO: assert that all expected fields exist, i.e. remoteTypeName, remoteNodeId
  //   also assert that Gatsby internal field names are not used
  //   i.e. "internal", "id", "parent", "children", "__typename", etc
  //   (Technically this should be caught in fragments validation before running a query
  //   but we should probably double-check for safety)

  const nodeData = await transformRemoteNode(context, def, remoteNode)

  const node: NodeInput = {
    ...nodeData,
    id: context.idTransform.toGatsbyNodeId(remoteNode, def),
    parent: undefined,
    internal: {
      contentDigest: createContentDigest(remoteNode),
      type: context.typeNameTransform.toGatsbyTypeName(def.remoteTypeName),
    },
  }

  await actions.createNode(node)
}
