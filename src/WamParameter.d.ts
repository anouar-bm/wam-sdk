import { WamParameter } from 'wam-api';

declare const getWamParameter: (moduleId?: string) => typeof WamParameter;

export default getWamParameter;
