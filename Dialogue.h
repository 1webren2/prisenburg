#ifndef DIALOGUE_H
#define DIALOGUE_H

#include <string>

// 游戏对话：一条台词 = 说话人 + 内容
class Dialogue {
public:
    Dialogue(const std::string& name, const std::string& dialogue);

    const std::string& name() const { return name_; }
    const std::string& dialogue() const { return dialogue_; }

private:
    std::string name_;
    std::string dialogue_;
};

#endif // DIALOGUE_H
