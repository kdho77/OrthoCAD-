// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
    children: ReactNode;
}

interface State {
    error: Error | null;
}

/** Catches render/runtime errors in the workspace and shows a recovery UI. */
export class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error("[ErrorBoundary]", error, info.componentStack);
    }

    render() {
        if (this.state.error) {
            return (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                    <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
                    <p className="max-w-md text-sm text-muted-foreground">{this.state.error.message}</p>
                    <Button
                        onClick={() => {
                            this.setState({ error: null });
                            window.location.reload();
                        }}
                    >
                        Reload workspace
                    </Button>
                </div>
            );
        }
        return this.props.children;
    }
}
