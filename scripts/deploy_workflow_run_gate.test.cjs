'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const workflow=fs.readFileSync('.github/workflows/deploy.yml','utf8');
test('automatic Pages deployment checks the exact completed Bite QA workflow event, not a lagging run list',()=>{
 assert.match(workflow,/qa_run_id="\$\{\{ github\.event\.workflow_run\.id \}\}"/);
 assert.match(workflow,/actions\/runs\/\$qa_run_id/);
 assert.match(workflow,/\.name == "Bite QA" and \.head_sha == \$sha/);
 assert.match(workflow,/\.head_branch == "main" and \.event == "push"/);
 assert.match(workflow,/\.status == "completed" and \.conclusion == "success"/);
});
test('automatic release refuses stale main and checks again immediately before publication',()=>{
 assert.match(workflow,/\[\[ "\$BITE_DEPLOY_SHA" == "\$current_main" \]\] \|\| \{ echo "Stale automatic deployment skipped"/);
 assert.match(workflow,/name: Recheck latest main before automatic publication/);
 assert.match(workflow,/Main advanced; refusing stale publication/);
});
test('manual Pages release retains independent passed exact SHA QA verification',()=>{
 assert.match(workflow,/name: Require successful main QA for this exact commit/);
 assert.match(workflow,/else\n\s+# Explicit manual deployment/);
 assert.match(workflow,/runs=\$\(gh api "repos\/\$GITHUB_REPOSITORY\/actions\/runs\?head_sha=\$BITE_DEPLOY_SHA/);
 assert.match(workflow,/\.workflow_runs \| any\(\.name == "Bite QA"/);
});
test('untrusted pull requests and failed QA cannot auto-deploy',()=>{
 assert.match(workflow,/github\.event\.workflow_run\.conclusion == 'success'/);
 assert.match(workflow,/github\.event\.workflow_run\.head_branch == 'main'/);
 assert.match(workflow,/github\.event\.workflow_run\.event == 'push'/);
 assert.match(workflow,/cancel-in-progress: true/);
 assert.match(workflow,/Verify the live public build matches the approved commit/);
 assert.match(workflow,/Verify live Customer and Owner guest browser flows/);
});
