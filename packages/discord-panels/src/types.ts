export type Issue=(intent:Record<string,unknown>,publicEntry?:boolean)=>Promise<string>;

export type MetricLike={
 metricKey:string;
 value:number|null;
 sampleSize:number;
 numerator?:number;
 denominator?:number;
 provisional:boolean;
 dataCoverage:{status:'healthy'|'degraded'|'incomplete'|'unavailable';expected:number|null;observed:number|null};
};

export type Metrics=Record<string,MetricLike>;
