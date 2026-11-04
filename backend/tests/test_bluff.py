import unittest
from copy import deepcopy
from collections import Counter
from games.bluff import engine
from games.bluff.questions import QUESTIONS, _FACTS
from lobby.games import GAMES
from lobby.rooms import LobbyRoom

class First:
    @staticmethod
    def choice(seq): return seq[0]

class BluffTest(unittest.TestCase):
    def state(self, n=3, circles=1):
        r=LobbyRoom('123456','p0','P0','🐭')
        for i in range(1,n): r.join(f'p{i}',f'P{i}','🐭')
        r.select_game('p0','bluff',{'participants':[f'p{i}' for i in range(n)],'circles':circles})
        return r.snapshot()['game_state']
    def ready(self,s):
        engine.act(s,s['judge'],'draw',{'difficulty':1},now=100,rng=First())
        for p in s['players']: engine.act(s,p,'ready',now=100)
        engine.advance_time(s,109)
    def test_bank(self):
        self.assertEqual(Counter(q['difficulty'] for q in QUESTIONS),{1:20,2:20,3:20})
        self.assertEqual(len({q['title'] for q in QUESTIONS}),60)
        self.assertTrue(all(q['source'].startswith('https://') and q['answer'] and len(q['hints'])=={1:1,2:3,3:0}[q['difficulty']] for q in QUESTIONS))
        for q, (_, _, category, _) in zip(QUESTIONS, _FACTS):
            self.assertEqual(q['hints'].count(category), 0 if q['difficulty']==3 else 1)
            self.assertEqual(len(q['hints']), len(set(q['hints'])))
    def test_spectators_replacements_and_validation(self):
        r=LobbyRoom('123456','p0','P0','🐭')
        for i in range(1,12): r.join(f'p{i}',f'P{i}','🐭')
        for n in (2,10):
            with self.assertRaises(ValueError):
                r.select_game('p0','bluff',{'participants':[f'p{i}' for i in range(1,n+1)]})
        r.select_game('p0','bluff',{'participants':[f'p{i}' for i in range(1,10)]})
        s=r.snapshot()['game_state']; judge=s['judge']
        for p in ('p0','p10','p11'):
            self.assertNotIn('my_role',engine.view(s,p))
            with self.assertRaises(engine.RuleError):engine.act(s,p,'draw',{'difficulty':1})
        with self.assertRaises(engine.RuleError):engine.act(s,judge,'draw',{'difficulty':True})
        with self.assertRaises(engine.RuleError):engine.act(s,judge,'draw',[])
        engine.act(s,judge,'draw',{'difficulty':1},rng=First()); first=s['question_id']
        engine.act(s,judge,'skip'); engine.act(s,judge,'draw',{'difficulty':1},rng=First())
        self.assertNotEqual(first,s['question_id']); self.assertIn(first,s['used'])
        engine.act(s,'p0','terminate');self.assertTrue(s['terminated'])
    def test_checkpoint_and_ties(self):
        s=self.state(); engine.act(s,s['judge'],'draw',{'difficulty':1},now=10,rng=First())
        for p in s['players']:engine.act(s,p,'ready',now=10)
        s['remaining']=4.5
        members=deepcopy(s['members'])
        for m in members.values():m['connected']=False
        engine.presence(s,members,now=500,restarting=True)
        self.assertEqual(s['remaining'],4.5);self.assertTrue(s['paused'])
        engine.act(s,'p0','terminate',now=501)
        self.assertCountEqual(engine.view(s,'spectator')['winners'],s['players'])
    def test_boundaries_and_privacy(self):
        for n in (3,9):
            s=self.state(n);self.assertEqual(len(s['players']),n);self.assertEqual(Counter(s['roles'].values())['honest'],1)
        s=self.state();judge=s['judge'];honest=next(p for p in s['players'] if s['roles'][p]=='honest')
        engine.act(s,judge,'draw',{'difficulty':2},now=100,rng=First())
        for p in s['players']:
            v=engine.view(s,p,100);self.assertNotIn('answer',v);self.assertNotIn('roles',v)
        for p in s['players']:engine.act(s,p,'ready',now=100)
        self.assertIn('answer',engine.view(s,honest,108.9));self.assertNotIn('answer',engine.view(s,judge,108.9));self.assertNotIn('answer',engine.view(s,'spectator',108.9));self.assertNotIn('answer',engine.view(s,honest,109))
    def test_pause_resume(self):
        s=self.state();engine.act(s,s['judge'],'draw',{'difficulty':1},now=10,rng=First())
        for p in s['players']:engine.act(s,p,'ready',now=10)
        m=deepcopy(s['members']);m[s['players'][0]]['connected']=False
        engine.presence(s,m,now=13);self.assertTrue(s['paused']);self.assertEqual(s['remaining'],6)
        honest=next(p for p in s['players'] if s['roles'][p]=='honest');self.assertNotIn('answer',engine.view(s,honest,50))
        m[s['players'][0]]['connected']=True;engine.presence(s,m,now=50)
        self.assertEqual(s['deadline'],56);self.assertIn('answer',engine.view(s,honest,55));self.assertNotIn('answer',engine.view(s,honest,56))
    def test_scores(self):
        for correct in (True,False):
            for challenge_honest in (True,False):
                s=self.state(4);self.ready(s);judge=s['judge'];honest=next(p for p in s['players'] if s['roles'][p]=='honest');bluff=next(p for p in s['players'] if s['roles'][p]=='bluffer')
                with self.assertRaises(engine.RuleError):engine.act(s,judge,'guess',{'target_id':honest},now=110)
                engine.act(s,judge,'challenge',{'target_id':honest if challenge_honest else bluff},now=110)
                with self.assertRaises(engine.RuleError):engine.act(s,judge,'challenge',{'target_id':bluff},now=110)
                engine.act(s,judge,'guess',{'target_id':honest if correct else bluff},now=110)
                delta=s['result']['delta'];self.assertEqual(delta[judge],(1 if correct else 0)+(-3 if challenge_honest else 1));self.assertEqual(delta[honest],1 if correct else 0);self.assertEqual(delta[bluff],(1 if not correct else 0)+(-1 if not challenge_honest else 0))
                with self.assertRaises(engine.RuleError):engine.act(s,judge,'guess',{'target_id':honest},now=110)
    def test_rotation_exhaustion_and_termination(self):
        s=self.state(3,2);order=s['players'][:]
        for i in range(6):
            self.assertEqual(s['judge'],order[i%3]);self.ready(s);j=s['judge'];target=next(p for p in s['players'] if p!=j)
            engine.act(s,j,'challenge',{'target_id':target},now=110);engine.act(s,j,'guess',{'target_id':target},now=110);engine.act(s,j,'next',now=110)
        self.assertEqual(s['phase'],'finished');self.assertEqual(len(s['history']),6);self.assertTrue(GAMES['bluff'].can_switch(s))
        s=self.state();s['used']=[q['id'] for q in QUESTIONS if q['difficulty']==1]
        with self.assertRaises(engine.RuleError):engine.act(s,s['judge'],'draw',{'difficulty':1},rng=First())
        s['paused']=True
        with self.assertRaises(engine.RuleError):engine.act(s,'p1','terminate')
        engine.act(s,'p0','terminate');self.assertTrue(s['terminated'])

if __name__=='__main__':unittest.main()
