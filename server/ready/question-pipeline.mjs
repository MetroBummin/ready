export const CURRENT_QUESTION_PUBLICATION_VERSION=3;

export function questionPublicationVersion(payload){
  return Number(payload?.publication_version)||0;
}

export function questionPublicationStatus(payload){
  return questionPublicationVersion(payload)>=CURRENT_QUESTION_PUBLICATION_VERSION?'CURRENT':'STALE';
}
