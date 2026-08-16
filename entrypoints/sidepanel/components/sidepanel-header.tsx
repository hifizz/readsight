import type { ReactNode } from 'react';
import { BookmarkPlus, FolderPlus, LogOut } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import type { AuthUser } from '@/lib/auth';
import { initials } from '../utils';

export function SidePanelHeader({
  user,
  signingOut,
  onCapture,
  onCreateProject,
  onSignOut
}: {
  user: AuthUser;
  signingOut: boolean;
  onCapture: () => void;
  onCreateProject: () => void;
  onSignOut: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 flex items-center border-b border-b-[0.5px] bg-background/95 px-2 py-1 backdrop-blur">
      <h1 className="mr-auto pl-1 text-sm ">阅读列表</h1>
      <HeaderAction label="保存当前链接" onClick={onCapture}>
        <BookmarkPlus />
      </HeaderAction>
      <HeaderAction label="创建 Project" onClick={onCreateProject}>
        <FolderPlus />
      </HeaderAction>
      <UserMenu
        className="ml-1"
        user={user}
        signingOut={signingOut}
        onSignOut={onSignOut}
      />
    </header>
  );
}

function HeaderAction({
  label,
  onClick,
  children
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-neutral-500"
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function UserMenu({
  user,
  signingOut,
  onSignOut,
  className
}: {
  user: AuthUser;
  signingOut: boolean;
  onSignOut: () => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={`rounded-full ${className}`}
          aria-label="用户菜单"
        >
          <Avatar size="sm">
            <AvatarImage src={(user as AuthUser & { image?: string }).image} />
            <AvatarFallback>{initials(user.name || user.email)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="grid gap-0.5">
          <span className="truncate text-foreground">{user.name}</span>
          <span className="truncate font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={signingOut}
          onSelect={onSignOut}
        >
          <LogOut />
          {signingOut ? '退出中…' : '退出登录'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
