/** Server-only initialization; browser expression/type validation stays portable. */
import {loadScratchMpfrEngine} from './scratch-mpfr-loader';
import type {ValidateFlowOptions} from './definition';
export async function scratchNumericOptions(definition:unknown):Promise<Pick<ValidateFlowOptions,'numericMath'>> {
  if(!definition||typeof definition!=='object'||!('semanticProfile' in definition)||definition.semanticProfile!=='scratch.v1')return {};
  const engine=await loadScratchMpfrEngine();
  return {numericMath:(operator,value)=>engine.evaluate(operator,value)};
}
