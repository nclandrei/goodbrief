import { existsSync } from 'fs';
import { join } from 'path';
import { getIssuePublicationInfo } from './newsletter-week.js';

export interface SendPreflight {
  draftExists: boolean;
  draftPath: string;
  issueExists: boolean;
  issueFilename: string;
  issuePath: string;
}

export function getSendPreflight(rootDir: string, weekId: string): SendPreflight {
  const draftPath = join(rootDir, 'data', 'drafts', `${weekId}.json`);
  const issueInfo = getIssuePublicationInfo(rootDir, weekId);

  return {
    draftExists: existsSync(draftPath),
    draftPath,
    issueExists: existsSync(issueInfo.outputPath),
    issueFilename: issueInfo.filename,
    issuePath: issueInfo.outputPath,
  };
}
