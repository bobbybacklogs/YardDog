/**
 * Re-export HostedYardDog into the Eve agent tree (Phase 2).
 * Model path remains AiSdkAdapter — ModelHitch is not used.
 */

export {
  HostedYardDog,
  type HostedYardDogOptions,
  type HostedModelTurn,
} from "../../../src/core/hosted-harness.ts";
