import { WamParameterInfo } from 'wam-api';

declare const getWamParameterInfo: (moduleId?: string) => typeof WamParameterInfo;

export default getWamParameterInfo;
