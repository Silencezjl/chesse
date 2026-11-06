import type {GameContext} from '../platform/context';
import {mount as mountBluff} from './bluff';
import css from './bluff.css?inline';
export function mount(context:GameContext,element:HTMLElement){
 context.root.querySelector('style')!.textContent+=css.replaceAll(':root',':host');
 return mountBluff({...context,element});
}
