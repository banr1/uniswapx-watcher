// lib/fetch-orders.ts

import { DutchOrder, OrderType } from '@uniswap/uniswapx-sdk';
import axios from 'axios';

import { UNISWAPX_API_ENDPOINT } from '@/constants/api-endpoint';
import { ignoreIntentHashes } from '@/constants/ignore-intent-hashes';
import { UNISWAP_REACTOR_ADDRESSES } from '@/constants/uniswap-reactor-addresses';
import { ChainId } from '@/types/chain-id';
import { DutchIntentV1, FilledDutchIntentV1, OpenDutchIntentV1, RawDutchIntentV1 } from '@/types/dutch-intent-v1';
import { DutchIntentV2, FilledDutchIntentV2, OpenDutchIntentV2, RawDutchIntentV2 } from '@/types/dutch-intent-v2';
import { FetchOrdersParams } from '@/types/fetch-orders-params';

import fetchFillEvent from './fetch-fill-event';

export async function fetchIntents(params: FetchOrdersParams): Promise<DutchIntentV1[] | DutchIntentV2[]> {
  let intents;
  if (params.orderType === OrderType.Dutch) {
    const res = await axios.get<{ orders: RawDutchIntentV1[] }>(UNISWAPX_API_ENDPOINT, { params });
    intents = res.data.orders
      .map((order) => decodeOrderV1(order, params.chainId))
      .filter((order): order is DutchIntentV1 => order !== null);
  } else if (params.orderType === OrderType.Dutch_V2) {
    const res = await axios.get<{ orders: RawDutchIntentV2[] }>(UNISWAPX_API_ENDPOINT, { params });
    intents = res.data.orders
      .map((order) => decodeOrderV2(order, params.chainId))
      .filter((order): order is DutchIntentV2 => order !== null);

    if (params.orderStatus === 'filled') {
      intents = await Promise.all(
        intents.map(async (intent) => {
          const fillEvent = await fetchFillEvent(intent.txHash!, params.chainId);
          if (!fillEvent) {
            throw new Error('Fill event not found');
          }
          return {
            ...intent,
            filler: fillEvent.args.filler,
          } as FilledDutchIntentV2;
        }),
      );
    }
  } else {
    throw new Error('Invalid order type');
  }

  return intents;
}

const decodeOrderV1 = (order: RawDutchIntentV1, chainId: ChainId): DutchIntentV1 | null => {
  const decodedOrder = DutchOrder.parse(order.encodedOrder, chainId);
  if (ignoreIntentHashes.includes(decodedOrder.hash())) return null;

  if (order.orderStatus === 'filled') {
    return {
      hash: decodedOrder.hash(),
      input: decodedOrder.info.input,
      outputs: decodedOrder.info.outputs,
      decayStartTime: decodedOrder.info.decayStartTime,
      decayEndTime: decodedOrder.info.decayEndTime,
      swapper: decodedOrder.info.swapper,
      filler: decodedOrder.info.exclusiveFiller,
      reactor: decodedOrder.info.reactor,
      chainId: order.chainId,
      orderStatus: 'filled',
      type: OrderType.Dutch,
      version: 1,
      settlements: order.settledAmounts!,
      txHash: order.txHash!,
      createdAt: order.createdAt,
    } as FilledDutchIntentV1;
  } else if (order.orderStatus === 'open') {
    return {
      hash: decodedOrder.hash(),
      input: decodedOrder.info.input,
      outputs: decodedOrder.info.outputs,
      decayStartTime: decodedOrder.info.decayStartTime,
      decayEndTime: decodedOrder.info.decayEndTime,
      swapper: decodedOrder.info.swapper,
      filler: decodedOrder.info.exclusiveFiller,
      reactor: decodedOrder.info.reactor,
      chainId: order.chainId,
      orderStatus: 'open',
      type: OrderType.Dutch,
      version: 1,
      settlements: null,
      txHash: null,
      createdAt: order.createdAt,
    } as OpenDutchIntentV1;
  } else {
    throw new Error('Invalid order status');
  }
};

const decodeOrderV2 = (order: RawDutchIntentV2, chainId: ChainId): DutchIntentV2 => {
  if (!['open', 'filled'].includes(order.orderStatus)) {
    throw new Error('Invalid order status');
  }

  // const parsedOrder = DutchOrder.parse(order.encodedOrder, chainId);

  const decodedOrder = {
    hash: order.orderHash,
    input: order.input,
    outputs: order.outputs,
    decayStartTime: order.cosignerData.decayStartTime,
    decayEndTime: order.cosignerData.decayEndTime,
    swapper: order.swapper,
    filler: order.cosignerData.exclusiveFiller,
    reactor: UNISWAP_REACTOR_ADDRESSES[chainId],
    chainId: order.chainId,
    txHash: order.orderStatus === 'filled' ? order.txHash : null,
    orderStatus: order.orderStatus,
    type: OrderType.Dutch_V2,
    version: 2,
    createdAt: order.createdAt,
  };
  if (order.orderStatus === 'filled') {
    return decodedOrder as FilledDutchIntentV2;
  } else {
    return decodedOrder as OpenDutchIntentV2;
  }
};