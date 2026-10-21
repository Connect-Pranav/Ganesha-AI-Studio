// Settings → "UI components (shadcn/ui)": a live gallery of the shadcn/ui parts available to the app.
// Purely local UI: nothing here calls the API, sends, publishes or saves anything.
import { useState } from 'react';
import { Loader2, Plus, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '../ui';
import { Badge } from './badge';
import { Button } from './button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './dialog';
import { Input } from './input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { Textarea } from './textarea';

export function UiKitCard() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Card title="UI components (shadcn/ui)">
      <div data-slot="ui-kit" className="tw:flex tw:flex-col tw:gap-5 tw:text-foreground">
        <p className="tw:text-sm tw:text-muted-foreground">Preview only. These buttons do not send, publish or save anything.</p>

        <section className="tw:flex tw:flex-col tw:gap-2">
          <h3 className="tw:text-sm tw:font-semibold">Buttons</h3>
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive"><Trash2 /> Delete</Button>
            <Button variant="link">Link</Button>
            <Button size="sm"><Plus /> Small</Button>
            <Button size="icon" aria-label="Send"><Send /></Button>
            <Button disabled={busy} onClick={() => (setBusy(true), setTimeout(() => setBusy(false), 1200))}>
              {busy && <Loader2 className="tw:animate-spin" />} {busy ? 'Working…' : 'Loading state'}
            </Button>
          </div>
        </section>

        <section className="tw:flex tw:flex-col tw:gap-2">
          <h3 className="tw:text-sm tw:font-semibold">Badges</h3>
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            <Badge>LittleLoop</Badge>
            <Badge variant="secondary">Sunverse</Badge>
            <Badge variant="outline">Foliocraft</Badge>
            <Badge variant="destructive">Failed</Badge>
          </div>
        </section>

        <section className="tw:flex tw:flex-col tw:gap-2 tw:max-w-md">
          <h3 className="tw:text-sm tw:font-semibold">Inputs</h3>
          <Input placeholder="Campaign name" value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea placeholder="Notes…" rows={3} />
        </section>

        <section className="tw:flex tw:flex-col tw:gap-2">
          <h3 className="tw:text-sm tw:font-semibold">Tabs</h3>
          <Tabs defaultValue="littleloop" className="tw:max-w-md">
            <TabsList>
              <TabsTrigger value="littleloop">LittleLoop</TabsTrigger>
              <TabsTrigger value="sunverse">Sunverse</TabsTrigger>
              <TabsTrigger value="foliocraft">Foliocraft</TabsTrigger>
            </TabsList>
            <TabsContent value="littleloop" className="tw:text-sm tw:text-muted-foreground">Kids' animated reels.</TabsContent>
            <TabsContent value="sunverse" className="tw:text-sm tw:text-muted-foreground">YouTube music channel.</TabsContent>
            <TabsContent value="foliocraft" className="tw:text-sm tw:text-muted-foreground">Portfolio builder.</TabsContent>
          </Tabs>
        </section>

        <section className="tw:flex tw:flex-wrap tw:gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Example dialog</DialogTitle>
                <DialogDescription>Use dialogs for confirmations, e.g. before approving a draft.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button onClick={() => toast.success('Confirmed (preview only)')}>Confirm</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button variant="secondary" onClick={() => toast('Saved', { description: 'Example toast (preview only).' })}>Show toast</Button>
          <Button variant="secondary" onClick={() => toast.error('Something failed (preview only)')}>Error toast</Button>
        </section>
      </div>
    </Card>
  );
}
