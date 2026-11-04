import test from 'node:test';
import assert from 'node:assert/strict';
import {describePage} from '../lib/page-labels.js';

test('distinguishes ChatGPT conversations and Instagram profiles and posts',()=>{
 assert.equal(describePage('https://chatgpt.com/','ChatGPT').title,'ChatGPT 홈');
 assert.deepEqual(describePage('https://chatgpt.com/c/abc','여행 계획'),{category:'ChatGPT 대화',title:'여행 계획',detail:'대화 ID abc',address:'chatgpt.com/c/abc',site:'chatgpt.com'});
 assert.equal(describePage('https://www.instagram.com/jay.otmakase/','Instagram').title,'@jay.otmakase');
 assert.equal(describePage('https://www.instagram.com/p/ABC/','Instagram').category,'Instagram 게시물');
 assert.equal(describePage('https://www.instagram.com/reel/XYZ/','Instagram').title,'릴스 · XYZ');
 assert.equal(describePage('https://www.instagram.com/explore/','Instagram').category,'Instagram');
 assert.equal(describePage('https://example.com/','기사').title,'기사');
 assert.equal(describePage('https://example.com/article/42?view=full','기사').address,'example.com/article/42?view=full');
});
