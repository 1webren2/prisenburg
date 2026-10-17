#ifndef SCENE_H
#define SCENE_H

#include <string>
#include <vector>

#include "Choice.h"
#include "Dialogue.h"

// 游戏场景：一个场景包含若干台词和若干选择
class Scene {
public:
    explicit Scene(const std::string& id);

    const std::string& id() const { return id_; }

    void addDialogue(const Dialogue& dialogue);
    void addDialogue(const std::string& name, const std::string& text);
    void addChoice(const Choice& choice);

    const std::vector<Dialogue>& dialogues() const { return dialogues_; }
    const std::vector<Choice>& choices() const { return choices_; }

private:
    std::string id_;
    std::vector<Dialogue> dialogues_;
    std::vector<Choice> choices_;
};

#endif // SCENE_H
